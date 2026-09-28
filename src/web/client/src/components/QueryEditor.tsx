import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { DdhqEnvironment } from '../api.js';

import { api } from '../api.js';

interface Props {
	environment: DdhqEnvironment | null; // null: not switchable (DDHQ off)
}

// Editable DDHQ query list — one /api/v4/races query string per line — and which DDHQ
// host it runs against. Sim points DDHQ and Chameleon at elex_sim's mirror, which plays
// a recorded night back; the queries must match the recording's. Both are runtime state on the server; the poller picks up
// edits on its next tick. The environment isn't copied locally: the server's value
// arrives with every state push, so the toggle can't drift from what's polled.
const QueryEditor: React.FC<Props> = (props) => {
	const [text, setText] = React.useState('');
	const [msg, setMsg] = React.useState('');

	React.useEffect(() => {
		void api.getQueries().then((r) => setText(r.queries.join('\n')));
	}, []);

	const save = async (): Promise<void> => {
		const queries = text
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		const r = await api.setQueries(queries);
		setText(r.queries.join('\n'));
		setMsg(`saved ${r.queries.length}`);
	};

	const switchEnvironment = (next: DdhqEnvironment | null): void => {
		if (next === null || next === props.environment) return;
		api
			.setDdhqEnvironment(next)
			.then(() => setMsg(`switched to ${next} — takes effect on the next poll`))
			.catch((e: unknown) =>
				setMsg(e instanceof Error ? `switch failed: ${e.message}` : 'switch failed'),
			);
	};

	return (
		<Box>
			{props.environment !== null && (
				<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mb: 1.5 }}>
					<Typography color="text.secondary" variant="caption">
						environment:
					</Typography>
					<ToggleButtonGroup
						exclusive={true}
						onChange={(_event, next: DdhqEnvironment | null) => switchEnvironment(next)}
						size="small"
						value={props.environment}
					>
						<ToggleButton value="production">Production</ToggleButton>
						<ToggleButton color="warning" value="integration">
							Integration (test)
						</ToggleButton>
						<ToggleButton color="secondary" value="sim">
							Sim (elex_sim)
						</ToggleButton>
					</ToggleButtonGroup>
				</Box>
			)}
			<TextField
				fullWidth
				minRows={3}
				multiline
				onChange={(e) => setText(e.target.value)}
				placeholder={'race_ids=123,456\nstate=TX&office_id=3'}
				slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
				value={text}
			/>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mt: 1 }}>
				<Button onClick={() => void save()} size="small" variant="outlined">
					Save queries
				</Button>
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Box>
		</Box>
	);
};

export default QueryEditor;
