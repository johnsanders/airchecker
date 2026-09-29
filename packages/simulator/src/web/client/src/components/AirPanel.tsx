import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AirSource, AirStatus, Settings, Status } from '../api.js';

import { api } from '../api.js';

interface Props {
	onChange: () => Promise<void>;
	status: Status | undefined;
}

const DEFAULT_MINUTES = 30;

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

const airLine = (air: AirStatus | null, playing: boolean): string => {
	if (air === null)
		return playing
			? "Off air: the recording playing has none of the take list's races in its Chameleon data"
			: 'Off air';
	const called = `${air.called} of ${air.races} races called`;
	if (air.recording !== null)
		return `Recording ${air.recording} on air · ${minutes(air.elapsedMs)} of ${minutes(air.durationMs)} · ${called}`;
	const faulty =
		air.faultRate > 0 ? ` · ${Math.round(air.faultRate * 100)}% of graphics wrong` : '';
	return `${minutes(air.elapsedMs)} of ${minutes(air.durationMs)}${air.elapsedMs >= air.durationMs ? ' (all in)' : ''} · ${called}${faulty} · seed ${air.seed}`;
};

// Runs the simulated air feed at /air/: the ticker always up, an L3 or FS every 10–20 s,
// over a looping newscast, filled from a night of results — invented, or, during a DDHQ
// testing window, pulled live from DDHQ's integration host. Start rolls a new night (a
// restart is just another Start); the source picked at Start is what that night uses,
// so changing it mid-night takes effect on the next one. A recording playing back (the
// API recordings section) is on air too, and a night started here replaces it. A night can
// put wrong graphics on air, for the checker to catch: the share of airings given here get
// wrong votes, a wrong % in, old figures, a wrong ✓ or a misspelled name, while DDHQ and
// Chameleon stay right.
const AirPanel: React.FC<Props> = (props) => {
	const [durationMinutes, setDurationMinutes] = React.useState(String(DEFAULT_MINUTES));
	const [faultPercent, setFaultPercent] = React.useState('0');
	const [settings, setSettings] = React.useState<Settings | undefined>(undefined);
	const [msg, setMsg] = React.useState('');
	const air = props.status?.air ?? null;
	const night = air !== null && air.recording === null;

	React.useEffect(() => {
		void api.getSettings().then(setSettings);
	}, []);

	const act = async (action: () => Promise<unknown>): Promise<void> => {
		try {
			await action();
			setMsg('');
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'failed');
		}
		await props.onChange();
	};

	const setAirSource = async (airSource: AirSource): Promise<void> => {
		// Refetched, not the settings this loaded with: SettingsEditor writes the same
		// object, and a stale copy of it here would clobber that.
		const latest = await api.getSettings();
		setSettings(await api.setSettings({ ...latest, airSource }));
	};

	return (
		<Box>
			<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
				<ToggleButtonGroup
					disabled={night}
					exclusive={true}
					onChange={(_event, next: AirSource | null) => {
						if (next !== null) void setAirSource(next);
					}}
					size="small"
					value={settings?.airSource ?? 'invented'}
				>
					<ToggleButton value="invented">Invented</ToggleButton>
					<ToggleButton color="warning" value="ddhqIntegration">
						DDHQ integration
					</ToggleButton>
				</ToggleButtonGroup>
				<TextField
					label="night length (min)"
					onChange={(event) => setDurationMinutes(event.target.value)}
					size="small"
					sx={{ width: 160 }}
					type="number"
					value={durationMinutes}
				/>
				<TextField
					label="graphics wrong (%)"
					onChange={(event) => setFaultPercent(event.target.value)}
					size="small"
					slotProps={{ htmlInput: { max: 100, min: 0 } }}
					sx={{ width: 160 }}
					type="number"
					value={faultPercent}
				/>
				<Button
					onClick={() =>
						void act(() => api.startAir(Number(durationMinutes), Number(faultPercent)))
					}
					variant="contained"
				>
					{night ? '↺ New night' : '▶ Start night'}
				</Button>
				{night && (
					<Button color="error" onClick={() => void act(api.stopAir)} variant="outlined">
						■ Stop
					</Button>
				)}
				<Button href="/air/" target="_blank" variant="outlined">
					Watch live feed ↗
				</Button>
				<Typography variant="body2">
					{airLine(air, (props.status?.playback ?? null) !== null)}
				</Typography>
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Stack>
			{props.status !== undefined && props.status.liveResultErrors.length > 0 && (
				<Typography color="error" sx={{ display: 'block', mb: 1 }} variant="caption">
					DDHQ integration: {props.status.liveResultErrors.join('; ')}
				</Typography>
			)}
			<Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
				While a night runs, the DDHQ and Chameleon mirrors serve it too (starting one stops any
				recording playback). Playing an API recording puts it on air instead: its take-list races,
				with its recorded Chameleon numbers. Put the checker in Sim mode; it opens the feed (
				<Link href="/air/" target="_blank">
					/air/
				</Link>
				) in its debug Chrome by itself. The newscast under the graphics is
				recordings/air/background.mp4.
			</Typography>
		</Box>
	);
};

export default AirPanel;
