import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import { AIR_PRESETS, api } from '../api.js';
import type { Cadence, Observation } from '../api.js';
import { ago, pct } from '../format.js';

interface Props {
  cadence: Cadence | null;
  lastFrame: { observations: Observation[]; ts: number } | null;
}

// Manual capture + live cadence control + the last captured frame and what the VLM
// read from it ("what it read", not a positional overlay — extractFrame returns
// values, not coordinates).
const CapturePanel: React.FC<Props> = (props) => {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [seconds, setSeconds] = React.useState(
    props.cadence ? Math.round(props.cadence.intervalMs / 1000) : 5,
  );
  // Which tab the capturer targets (URL substring), loaded from the server.
  const [airMatch, setAirMatch] = React.useState<string | null>(null);
  React.useEffect(() => {
    void api.getAirMatch().then((r) => setAirMatch(r.match));
  }, []);
  const pickPreset = (match: string): void => {
    setAirMatch(match);
    void api.setAirMatch(match);
  };

  // Cache-bust the frame image per timestamp so it refreshes on each capture.
  const frameSrc = props.lastFrame ? `/api/last-frame?ts=${props.lastFrame.ts}` : undefined;

  const capture = async (): Promise<void> => {
    setBusy(true);
    setMsg('capturing…');
    try {
      const r = await api.capture();
      setMsg(r.ran ? 'captured' : r.error ?? 'skipped (busy)');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  };

  const setMode = (mode: 'interval' | 'manual'): void => {
    void api.setCadence({ mode });
  };
  const applyInterval = (): void => {
    void api.setCadence({ intervalMs: Math.max(1, seconds) * 1000 });
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={() => void capture()} disabled={busy}>
          Capture now
        </Button>
        {props.cadence && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={props.cadence.mode}
            onChange={(_e, v) => v && setMode(v as 'interval' | 'manual')}
          >
            <ToggleButton value="manual">Manual</ToggleButton>
            <ToggleButton value="interval">Interval</ToggleButton>
          </ToggleButtonGroup>
        )}
        {props.cadence?.mode === 'interval' && (
          <>
            <TextField
              size="small"
              type="number"
              label="secs"
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              sx={{ width: 80 }}
            />
            <Button size="small" onClick={applyInterval}>
              Set
            </Button>
          </>
        )}
        <Typography variant="caption" color="text.secondary">
          {msg}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          source tab:
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={airMatch}>
          {AIR_PRESETS.map((preset) => (
            <ToggleButton key={preset.match} value={preset.match} onClick={() => pickPreset(preset.match)}>
              {preset.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {airMatch !== null && !AIR_PRESETS.some((p) => p.match === airMatch) && (
          <Typography variant="caption" color="text.secondary">
            ({airMatch})
          </Typography>
        )}
      </Stack>

      {frameSrc ? (
        <Box>
          <Box
            component="img"
            src={frameSrc}
            alt="last frame"
            sx={{ width: '100%', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
          />
          <Typography variant="caption" color="text.secondary">
            captured {ago(props.lastFrame?.ts)} · {props.lastFrame?.observations.length ?? 0} template(s) read
          </Typography>
          {props.lastFrame?.observations.map((o, i) => (
            <Box key={i} sx={{ mt: 1, fontSize: 12 }}>
              <b>{o.templateId ?? '?'}</b> — {o.raceKey} · {pct(o.pctIn)}% in
              {o.candidates.map((c) => (
                <div key={c.key} style={{ color: '#9fb0d6' }}>
                  {c.party} {c.name} — {pct(c.pct)}% / {c.votes.toLocaleString()}
                  {o.calledFor.includes(c.key) ? ' ✓' : ''}
                </div>
              ))}
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No frame captured yet.
        </Typography>
      )}
    </Box>
  );
};

export default CapturePanel;
