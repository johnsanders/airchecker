import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Anomaly } from '../reconcile/reconcile.js';
import type { Store } from '../store/store.js';
import type { QueryStore } from '../sources/provider/queryStore.js';

// The live web view at localhost:8787. Read-only state per source + recent alerts
// + the last captured frame, PLUS two controls: the manual capture button and the
// editable DDHQ query list. Pure HTTP over injected handles — no source logic here.

export type WebServerConfig = {
  // Manual capture trigger (the air scheduler's triggerCapture). Returns true if a
  // capture ran, false if skipped (busy). Optional — omitted if air isn't wired.
  triggerCapture?: () => Promise<boolean>;
  getLastFrame?: () => { hash: string; png: Buffer; ts: number } | undefined;
  getRecentAlerts: () => Anomaly[];
  queryStore?: QueryStore; // DDHQ queries get/set; omitted if DDHQ isn't configured
  store: Store;
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Eagle Eye</title>
<style>
 body{font:14px system-ui;margin:0;background:#0b1020;color:#e6e9f0}
 header{padding:12px 16px;background:#121a33;font-weight:600}
 .wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
 .card{background:#121a33;border:1px solid #243056;border-radius:8px;padding:12px}
 h2{margin:0 0 8px;font-size:13px;color:#9fb0d6;text-transform:uppercase;letter-spacing:.05em}
 button{background:#2d6cdf;color:#fff;border:0;border-radius:6px;padding:8px 12px;cursor:pointer}
 button:disabled{opacity:.5;cursor:wait}
 textarea{width:100%;box-sizing:border-box;background:#0b1020;color:#e6e9f0;border:1px solid #243056;border-radius:6px;padding:8px;font:12px monospace;min-height:80px}
 table{width:100%;border-collapse:collapse;font-size:12px}
 td,th{text-align:left;padding:4px 6px;border-bottom:1px solid #1c2747}
 .sev-high{color:#ff7676}.sev-medium{color:#ffce56}.sev-low{color:#9fb0d6}
 img{max-width:100%;border:1px solid #243056;border-radius:6px}
 .muted{color:#6b7aa3}
</style></head><body>
<header>Eagle Eye — live</header>
<div class="wrap">
 <div class="card"><h2>Sources</h2><div id="sources" class="muted">loading…</div></div>
 <div class="card"><h2>Capture</h2>
   <button id="cap">Capture now</button> <span id="capmsg" class="muted"></span>
   <h2 style="margin-top:16px">DDHQ queries (one per line)</h2>
   <textarea id="queries" placeholder="race_ids=123,456&#10;state=TX&office_id=3"></textarea>
   <div style="margin-top:8px"><button id="saveq">Save queries</button> <span id="qmsg" class="muted"></span></div>
 </div>
 <div class="card"><h2>Recent alerts</h2><div id="alerts" class="muted">none</div></div>
 <div class="card"><h2>Last frame</h2><div id="frame" class="muted">no frame yet</div></div>
</div>
<script>
 const j = (u,o) => fetch(u,o).then(r=>r.json());
 async function refresh(){
   const s = await j('/api/state');
   document.getElementById('sources').innerHTML = s.sources.map(x=>
     '<div>'+x.source+': <b>'+x.races+'</b> races, '+x.observations+' observations'+
     (x.lastAt?' · last '+new Date(x.lastAt).toLocaleTimeString():'')+'</div>').join('') || 'no data';
   document.getElementById('alerts').innerHTML = s.alerts.length? '<table><tr><th>sev</th><th>type</th><th>race</th><th>detail</th></tr>'+
     s.alerts.map(a=>'<tr><td class="sev-'+a.severity+'">'+a.severity+'</td><td>'+a.type+'</td><td>'+a.raceKey+'</td><td>'+a.detail+'</td></tr>').join('')+'</table>' : 'none';
   document.getElementById('frame').innerHTML = s.lastFrame? '<img src="/api/last-frame?ts='+s.lastFrame.ts+'"><div class="muted">'+new Date(s.lastFrame.ts).toLocaleTimeString()+'</div>' : 'no frame yet';
 }
 document.getElementById('cap').onclick = async (e)=>{
   e.target.disabled=true; document.getElementById('capmsg').textContent='capturing…';
   const r = await j('/api/capture',{method:'POST'});
   document.getElementById('capmsg').textContent = r.ran? 'captured' : (r.error||'skipped (busy)');
   e.target.disabled=false; refresh();
 };
 document.getElementById('saveq').onclick = async ()=>{
   const lines = document.getElementById('queries').value.split('\\n').map(s=>s.trim()).filter(Boolean);
   const r = await j('/api/queries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({queries:lines})});
   document.getElementById('qmsg').textContent = 'saved '+r.queries.length;
 };
 async function loadQueries(){ const r = await j('/api/queries'); document.getElementById('queries').value = r.queries.join('\\n'); }
 loadQueries(); refresh(); setInterval(refresh, 3000);
</script>
</body></html>`;

export const makeWebServer = (config: WebServerConfig): FastifyInstance => {
  const app = Fastify();

  app.get('/', (_req, reply) => reply.type('text/html').send(PAGE));

  app.get('/api/state', () => {
    const store = config.store;
    const sources = (['DDHQ', 'Ross', 'air'] as const).map((source) => {
      const histories = store.getRaceKeys().map((raceKey) => {
        if (source === 'DDHQ') return store.getProviderHistory(raceKey);
        if (source === 'Ross') return store.getVendorHistory(raceKey);
        return store.getAirHistory(raceKey);
      });
      const observations = histories.reduce((sum, h) => sum + h.length, 0);
      const races = histories.filter((h) => h.length > 0).length;
      const lastAt = Math.max(0, ...histories.flat().map((o) => o.observedAt));
      return { lastAt: lastAt > 0 ? lastAt : null, observations, races, source };
    });
    const lastFrame = config.getLastFrame?.();
    return {
      alerts: config.getRecentAlerts().slice(-50).reverse(),
      lastFrame: lastFrame === undefined ? null : { ts: lastFrame.ts },
      sources,
    };
  });

  app.get('/api/last-frame', (_req, reply) => {
    const frame = config.getLastFrame?.();
    if (frame === undefined) return reply.code(404).send({ error: 'no frame' });
    return reply.type('image/png').send(frame.png);
  });

  app.post('/api/capture', async (_req, reply) => {
    if (config.triggerCapture === undefined)
      return reply.code(503).send({ error: 'air capture not wired', ran: false });
    try {
      const ran = await config.triggerCapture();
      return { ran };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'capture failed', ran: false });
    }
  });

  app.get('/api/queries', () => ({ queries: config.queryStore?.get() ?? [] }));

  app.post<{ Body: { queries?: unknown } }>('/api/queries', (req, reply) => {
    if (config.queryStore === undefined)
      return reply.code(503).send({ error: 'DDHQ not configured' });
    const raw = req.body.queries;
    if (!Array.isArray(raw) || !raw.every((q) => typeof q === 'string'))
      return reply.code(400).send({ error: 'queries must be an array of strings' });
    config.queryStore.set(raw);
    return { queries: config.queryStore.get() };
  });

  return app;
};
