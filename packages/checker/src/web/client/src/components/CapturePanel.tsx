import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Cadence, Mode, Observation } from '../api.js';

import { AIR_PRESETS, api } from '../api.js';
import { ago, pct } from '../format.js';

interface Props {
	airMatch: null | string; // which tab Live mode captures (URL substring), as the server has it
	cadence: Cadence | null;
	lastFrame: { observations: Observation[]; ts: number } | null;
	mode: Mode | null;
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
	// No local copy of the selection: the server's value arrives with every state push,
	// so the toggle can't drift from what the capturer actually targets.
	const pickPreset = (match: string): void => {
		api
			.setAirMatch(match)
			.catch((e: unknown) =>
				setMsg(e instanceof Error ? `source switch failed: ${e.message}` : 'source switch failed'),
			);
	};

	// Cache-bust the frame image per timestamp so it refreshes on each capture.
	const frameSrc = props.lastFrame ? `/api/last-frame?ts=${props.lastFrame.ts}` : undefined;

	const capture = async (): Promise<void> => {
		setBusy(true);
		setMsg('capturing…');
		try {
			const r = await api.capture();
			setMsg(r.ran ? 'captured' : (r.error ?? 'skipped (busy)'));
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
			<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1.5 }}>
				<Button disabled={busy} onClick={() => void capture()} variant="contained">
					Capture now
				</Button>
				{props.cadence && (
					<ToggleButtonGroup
						exclusive
						onChange={(_e, v) => v && setMode(v as 'interval' | 'manual')}
						size="small"
						value={props.cadence.mode}
					>
						<ToggleButton value="manual">Manual</ToggleButton>
						<ToggleButton value="interval">Interval</ToggleButton>
					</ToggleButtonGroup>
				)}
				{props.cadence?.mode === 'interval' && (
					<>
						<TextField
							label="secs"
							onChange={(e) => setSeconds(Number(e.target.value))}
							size="small"
							sx={{ width: 80 }}
							type="number"
							value={seconds}
						/>
						<Button onClick={applyInterval} size="small">
							Set
						</Button>
					</>
				)}
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Stack>

			{props.mode === 'sim' ? (
				<Typography color="warning.main" sx={{ display: 'block', mb: 1.5 }} variant="body2">
					Sim mode: capturing the simulator's /air/ page. Keep it open in the debug Chrome.
				</Typography>
			) : (
				<Stack alignItems="center" direction="row" spacing={1} sx={{ mb: 1.5 }}>
					<Typography color="text.secondary" variant="caption">
						source tab:
					</Typography>
					<ToggleButtonGroup exclusive size="small" value={props.airMatch}>
						{AIR_PRESETS.map((preset) => (
							<ToggleButton
								key={preset.match}
								onClick={() => pickPreset(preset.match)}
								value={preset.match}
							>
								{preset.label}
							</ToggleButton>
						))}
					</ToggleButtonGroup>
					{props.airMatch !== null && !AIR_PRESETS.some((p) => p.match === props.airMatch) && (
						<Typography color="text.secondary" variant="caption">
							({props.airMatch})
						</Typography>
					)}
				</Stack>
			)}
			{frameSrc ? (
				<Box>
					<Box
						alt="last frame"
						component="img"
						src={frameSrc}
						sx={{
							border: '1px solid',
							borderColor: 'divider',
							borderRadius: 1,
							display: 'block',
							maxWidth: 720,
							width: '100%',
						}}
					/>
					<Typography color="text.secondary" variant="caption">
						captured {ago(props.lastFrame?.ts)} · {props.lastFrame?.observations.length ?? 0}{' '}
						template(s) read
					</Typography>
					{props.lastFrame?.observations.map((o) => (
						<Box key={`${o.templateId ?? '?'}|${o.raceKey}`} sx={{ fontSize: 12, mt: 1 }}>
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
				<Typography color="text.secondary" variant="body2">
					No frame captured yet.
				</Typography>
			)}
		</Box>
	);
};

export default CapturePanel;
