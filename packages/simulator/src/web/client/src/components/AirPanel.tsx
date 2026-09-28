import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Status } from '../api.js';

import { api } from '../api.js';

interface Props {
	onChange: () => Promise<void>;
	status: Status | undefined;
}

const DEFAULT_MINUTES = 30;

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

// Runs the simulated air feed at /air/: the ticker always up, an L3 or FS every 10–20 s,
// over a looping newscast, filled from an invented night of results. Start rolls a new
// night (a restart is just another Start).
const AirPanel: React.FC<Props> = (props) => {
	const [durationMinutes, setDurationMinutes] = React.useState(String(DEFAULT_MINUTES));
	const [msg, setMsg] = React.useState('');
	const air = props.status?.air ?? null;

	const act = async (action: () => Promise<unknown>): Promise<void> => {
		try {
			await action();
			setMsg('');
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'failed');
		}
		await props.onChange();
	};

	return (
		<Box>
			<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
				<TextField
					label="night length (min)"
					onChange={(event) => setDurationMinutes(event.target.value)}
					size="small"
					sx={{ width: 160 }}
					type="number"
					value={durationMinutes}
				/>
				<Button
					onClick={() => void act(() => api.startAir(Number(durationMinutes)))}
					variant="contained"
				>
					{air === null ? '▶ Start night' : '↺ New night'}
				</Button>
				{air !== null && (
					<Button color="error" onClick={() => void act(api.stopAir)} variant="outlined">
						■ Stop
					</Button>
				)}
				<Typography variant="body2">
					{air === null
						? 'Off air'
						: `${minutes(air.elapsedMs)} of ${minutes(air.durationMs)}${air.elapsedMs >= air.durationMs ? ' (all in)' : ''} · ${air.called} of ${air.races} races called · seed ${air.seed}`}
				</Typography>
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Stack>
			<Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
				<Link href="/air/" target="_blank">
					Open /air/
				</Link>{' '}
				in the checker's debug Chrome and pick its "Sim air" capture preset. The newscast under the
				graphics is recordings/air/background.mp4.
			</Typography>
		</Box>
	);
};

export default AirPanel;
