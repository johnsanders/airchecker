#!/usr/bin/env node
// Render a custom race lower third (the design from l3.psd) to PNG.
// Run `node render-l3.mjs --help` for usage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'l3.html');

const HELP = `Render a race lower third to PNG.

Usage:
  node render-l3.mjs --state TX --race "U.S. Senate" --pct-in 88 \\
    --cand1-name "James Talarico" --cand1-party D --cand1-pct 50.5 --cand1-votes 5566104 \\
    --cand1-photo fullscreen-assets/talarico.png \\
    --cand2-name "Ken Paxton" --cand2-party R --cand2-pct 49.5 --cand2-votes 5455885 \\
    --cand2-photo fullscreen-assets/paxton.png \\
    [--out l3.png] [--scale 1]

  node render-l3.mjs --json '{"state":"TX", ...}'   (or --json path/to/data.json)

Race:
  --state            State abbreviation, e.g. TX
  --race             Race name, e.g. "U.S. Senate" (upper-cased; squeezed to fit if long)
  --pct-in           Percent of expected vote in: 88, ">95", "<1" (shown as "88% IN")

Candidates (N = 1 or 2; candidate 1 is the left panel):
  --candN-name       Full name. Split into first/last at the last space; use "|" to
                     choose the split, e.g. "Mary Kay|Smith Jones"
  --candN-party      Party letter. D = blue panel, R = red panel, anything else = grey
  --candN-pct        Vote percent, e.g. 51 or 51.0 (shown with one decimal)
  --candN-votes      Vote count, e.g. 2788152 or "2,788,152"
  --candN-winner     Accepted for parity with render-ticker.mjs; this design has no
                     winner marker yet, so it currently has no visual effect
  --candN-photo      Headshot image (path or http(s) URL). The same 618x446 transparent
                     cutout used by render-fullscreen.mjs works here: it is scaled to cover
                     the 182x182 square, centred. A 182x182 cutout is used as-is.
                     Optional: without it the panel shows just the party colour.

Output (always a full 1920x1080 frame, transparent outside the graphic):
  --out              PNG path to write. Default: ./l3-<state>-<race>.png
  --scale            Pixel density multiplier, e.g. 2 for a 3840px-wide image. Default 1

  --json             All of the above as one JSON object (inline or a file path), using keys
                     state, race, pctIn, cand1/cand2 {name, party, votePercent, votes, isWinner, photo},
                     out, scale. Individual flags override JSON values.

On success prints one line of JSON to stdout: {"ok":true,"path":...,"width":...,"height":...}
On failure prints {"ok":false,"error":...} to stdout and exits non-zero.
Chrome is found automatically; set CHROME_PATH to use a specific browser binary.`;

class UsageError extends Error {}

// ---------- argument parsing ----------

const BOOLEAN_FLAGS = new Set(['cand1-winner', 'cand2-winner', 'help']);
const KNOWN_FLAGS = new Set([
  ...BOOLEAN_FLAGS, 'state', 'race', 'pct-in', 'out', 'scale', 'json',
  ...[1, 2].flatMap(n => ['name', 'party', 'pct', 'votes', 'photo'].map(k => `cand${n}-${k}`)),
]);

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new UsageError(`Unexpected argument: ${arg}`);
    let [key, value] = arg.slice(2).split(/=(.*)/s);
    if (value === undefined) {
      const next = argv[i + 1];
      const nextIsValue = next !== undefined && !next.startsWith('--');
      if (BOOLEAN_FLAGS.has(key) && !(nextIsValue && /^(true|false|yes|no|1|0)$/i.test(next))) {
        value = 'true';
      } else if (nextIsValue) {
        value = next;
        i++;
      } else {
        throw new UsageError(`Missing value for --${key}`);
      }
    }
    out[key] = value;
  }
  const unknown = Object.keys(out).filter(k => !KNOWN_FLAGS.has(k));
  if (unknown.length) throw new UsageError(`Unknown option(s): ${unknown.map(k => `--${k}`).join(', ')}`);
  return out;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return false;
  if (/^(true|yes|1)$/i.test(String(v))) return true;
  if (/^(false|no|0)$/i.test(String(v))) return false;
  throw new UsageError(`Expected true/false, got "${v}"`);
}

function loadJson(value) {
  const text = fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`--json is neither a readable file nor valid JSON: ${e.message}`);
  }
}

// Merge JSON input (if any) with individual flags; flags win.
function buildOptions(args) {
  const base = args.json ? loadJson(args.json) : {};
  const cand = n => {
    const c = { ...(base[`cand${n}`] || {}) };
    const pick = (flag, key) => { if (args[`cand${n}-${flag}`] !== undefined) c[key] = args[`cand${n}-${flag}`]; };
    pick('name', 'name'); pick('party', 'party'); pick('pct', 'votePercent');
    pick('votes', 'votes'); pick('winner', 'isWinner'); pick('photo', 'photo');
    return c;
  };
  return {
    state: args.state ?? base.state,
    race: args.race ?? base.race,
    pctIn: args['pct-in'] ?? base.pctIn,
    cand1: cand(1),
    cand2: cand(2),
    out: args.out ?? base.out,
    scale: args.scale ?? base.scale ?? 1,
  };
}

// ---------- validation ----------

function validate(o) {
  const errors = [];
  const need = (v, label) => {
    if (v === undefined || v === null || String(v).trim() === '') { errors.push(`${label} is required`); return false; }
    return true;
  };

  if (need(o.state, '--state') && !/^[A-Za-z]{2}$/.test(String(o.state).trim())) {
    errors.push(`--state must be a 2-letter abbreviation, got "${o.state}"`);
  }
  need(o.race, '--race');
  if (need(o.pctIn, '--pct-in')) {
    const m = String(o.pctIn).trim().replace(/%?\s*(IN)?$/i, '').match(/^([<>]?)\s*(\d+(?:\.\d+)?)$/);
    if (!m || Number(m[2]) > 100) errors.push(`--pct-in must look like 95, ">95" or "<1", got "${o.pctIn}"`);
    else o.pctIn = `${m[1]}${m[2]}`;
  }

  for (const n of [1, 2]) {
    const c = o[`cand${n}`];
    const f = k => `--cand${n}-${k}`;
    need(c.name, f('name'));
    if (need(c.party, f('party'))) {
      c.party = String(c.party).trim().toUpperCase();
      if (!/^[A-Z]$/.test(c.party)) errors.push(`${f('party')} must be a single letter, got "${c.party}"`);
    }
    if (need(c.votePercent, f('pct'))) {
      const p = Number(String(c.votePercent).replace(/%$/, ''));
      if (!Number.isFinite(p) || p < 0 || p > 100) errors.push(`${f('pct')} must be a number 0-100, got "${c.votePercent}"`);
      else c.votePercent = p;
    }
    if (need(c.votes, f('votes'))) {
      const v = Number(String(c.votes).replace(/,/g, ''));
      if (!Number.isInteger(v) || v < 0) errors.push(`${f('votes')} must be a whole number, got "${c.votes}"`);
      else c.votes = v;
    }
    try { c.isWinner = toBool(c.isWinner); } catch (e) { errors.push(`${f('winner')}: ${e.message}`); }
    if (c.photo !== undefined && c.photo !== null && String(c.photo).trim() !== '') {
      const photo = String(c.photo).trim();
      if (/^https?:\/\//i.test(photo)) c.photo = photo;
      else if (!fs.existsSync(photo)) errors.push(`${f('photo')}: file not found: ${photo}`);
      else c.photo = pathToFileURL(path.resolve(photo)).href;
    } else {
      c.photo = null;
    }
  }

  o.scale = Number(o.scale);
  if (!(o.scale > 0 && o.scale <= 4)) errors.push(`--scale must be a number between 0 and 4`);

  if (errors.length) throw new UsageError(errors.join('; '));

  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  o.out = path.resolve(o.out || `l3-${slug(o.state)}-${slug(o.race)}.png`);
  if (!o.out.toLowerCase().endsWith('.png')) o.out += '.png';
  return o;
}

// ---------- rendering ----------

async function render(o) {
  const launchOpts = { headless: true, args: ['--allow-file-access-from-files', '--hide-scrollbars'] };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  else launchOpts.channel = 'chrome';

  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    throw new Error(`Could not launch Chrome (${e.message.split('\n')[0]}). Install Google Chrome or set CHROME_PATH.`);
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: o.scale });

    const data = { state: o.state, race: o.race, pctIn: o.pctIn, cand1: o.cand1, cand2: o.cand2 };
    await page.evaluateOnNewDocument(d => { window.L3_DATA = d; }, data);
    await page.goto(pathToFileURL(TEMPLATE).href, { waitUntil: 'load' });
    await page.waitForFunction('window.l3Ready === true', { timeout: 15000 });

    const fontsOk = await page.evaluate(() =>
      [600, 700, 800, 900].every(w => document.fonts.check(`${w} 40px "Proxima Nova"`)) &&
      document.fonts.check('600 40px "Proxima Nova Cond"'));
    if (!fontsOk) throw new Error(`Proxima Nova did not load; expected the fonts/ folder next to l3.html`);

    const badPhotos = await page.evaluate(() =>
      [...document.querySelectorAll('.photo-area img')].filter(im => im.getAttribute('src') && !im.naturalWidth).map(im => im.src));
    if (badPhotos.length) throw new Error(`Could not load photo(s): ${badPhotos.join(', ')}`);

    fs.mkdirSync(path.dirname(o.out), { recursive: true });
    await page.screenshot({ path: o.out, omitBackground: true, type: 'png' });
    return { width: Math.round(1920 * o.scale), height: Math.round(1080 * o.scale) };
  } finally {
    await browser.close();
  }
}

// ---------- main ----------

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  const opts = validate(buildOptions(args));
  const size = await render(opts);
  console.log(JSON.stringify({ ok: true, path: opts.out, ...size }));
}

main().catch(err => {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  if (err instanceof UsageError) console.error('\nRun with --help for usage.');
  process.exit(err instanceof UsageError ? 2 : 1);
});
