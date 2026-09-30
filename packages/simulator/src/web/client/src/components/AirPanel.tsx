import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AirSchedule, AirSource, AirStatus, OverlayStatus, Settings, Status } from '../api.js';

import { api } from '../api.js';

interface Props {
	onChange: () => Promise<void>;
	status: Status | undefined;
}

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

const SCHEDULE_FIELDS: { key: keyof AirSchedule; label: string; width: number }[] = [
	{ key: 'tickerSeconds', label: 'ticker (s per race)', width: 140 },
	{ key: 'overlaySeconds', label: 'FS / L3 up (s)', width: 120 },
	{ key: 'gapSeconds', label: 'gap between (s)', width: 120 },
	{ key: 'fsCount', label: 'FS', width: 70 },
	{ key: 'l3Count', label: 'for every L3', width: 110 },
];

const GRAPHIC_NAMES = { fs: 'FS', l3: 'L3' };

const secondsUntil = (atMs: number): number => Math.max(0, Math.ceil((atMs - Date.now()) / 1000));

const overlayText = (overlay: OverlayStatus): string =>
	`${GRAPHIC_NAMES[overlay.kind]} ${overlay.race}`;

const upNextLine = (air: AirStatus): string =>
	[
		`Ticker: ${air.ticker}`,
		air.overlay === null
			? 'no FS / L3 up'
			: `Up: ${overlayText(air.overlay)}, ${secondsUntil(air.overlay.atMs)} s left`,
		air.next === null
			? 'ticker only'
			: `Next: ${overlayText(air.next)} in ${secondsUntil(air.next.atMs)} s`,
	].join(' · ');

const scheduleDraft = (schedule: AirSchedule): Record<keyof AirSchedule, string> => ({
	fsCount: String(schedule.fsCount),
	gapSeconds: String(schedule.gapSeconds),
	l3Count: String(schedule.l3Count),
	overlaySeconds: String(schedule.overlaySeconds),
	tickerSeconds: String(schedule.tickerSeconds),
});

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

// Runs the simulated air feed at /air/: the ticker always up and an FS or L3 over it, paced
// as set here, over a looping newscast, filled from a night of results — invented, or,
// during a DDHQ testing window, pulled live from DDHQ's integration host. Start rolls a new
// night (a restart is just another Start); the source and pacing at Start are what that
// night uses, so changing them mid-night takes effect on the next one. All of it is saved
// in settings.json as it's changed. A recording playing back (the API recordings section)
// is on air too, and a night started here replaces it. A night can put wrong graphics on
// air, for the checker to catch: the share of airings given here get wrong votes, a wrong %
// in, old figures, a wrong ✓ or a misspelled name, while DDHQ and Chameleon stay right.
const AirPanel: React.FC<Props> = (props) => {
	const [durationMinutes, setDurationMinutes] = React.useState('');
	const [faultPercent, setFaultPercent] = React.useState('');
	const [settings, setSettings] = React.useState<Settings | undefined>(undefined);
	const [msg, setMsg] = React.useState('');
	const [draft, setDraft] = React.useState<Record<keyof AirSchedule, string> | undefined>(
		undefined,
	);
	const air = props.status?.air ?? null;
	const night = air !== null && air.recording === null;

	React.useEffect(() => {
		void api.getSettings().then((loaded) => {
			setSettings(loaded);
			setDraft(scheduleDraft(loaded.airSchedule));
			setDurationMinutes(String(loaded.nightMinutes));
			setFaultPercent(String(loaded.faultPercent));
		});
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

	// Saved as each field is left; the server says what's out of range.
	const saveSettings = async (change: Partial<Settings>): Promise<void> => {
		const latest = await api.getSettings();
		try {
			setSettings(await api.setSettings({ ...latest, ...change }));
			setMsg('');
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'failed');
		}
	};

	const saveSchedule = (next: Record<keyof AirSchedule, string>): Promise<void> =>
		saveSettings({
			airSchedule: {
				fsCount: Number(next.fsCount),
				gapSeconds: Number(next.gapSeconds),
				l3Count: Number(next.l3Count),
				overlaySeconds: Number(next.overlaySeconds),
				tickerSeconds: Number(next.tickerSeconds),
			},
		});

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
					onBlur={() => void saveSettings({ nightMinutes: Number(durationMinutes) })}
					onChange={(event) => setDurationMinutes(event.target.value)}
					size="small"
					sx={{ width: 160 }}
					type="number"
					value={durationMinutes}
				/>
				<TextField
					label="graphics wrong (%)"
					onBlur={() => void saveSettings({ faultPercent: Number(faultPercent) })}
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
			{draft !== undefined && (
				<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
					{SCHEDULE_FIELDS.map((field) => (
						<TextField
							key={field.key}
							label={field.label}
							onBlur={() => void saveSchedule(draft)}
							onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
							size="small"
							slotProps={{ htmlInput: { min: 0 } }}
							sx={{ width: field.width }}
							type="number"
							value={draft[field.key]}
						/>
					))}
					<Typography color="text.secondary" variant="caption">
						Pacing takes effect at the next Start (or the next play, pause or resume of a
						recording). FS and L3 both 0 is the ticker alone.
					</Typography>
				</Stack>
			)}
			{air !== null && (
				<Typography sx={{ display: 'block', mb: 1 }} variant="body2">
					{upNextLine(air)}
				</Typography>
			)}
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
