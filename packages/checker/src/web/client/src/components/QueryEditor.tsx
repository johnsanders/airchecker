import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { DdhqHost, Mode } from '../api.js';

import { api } from '../api.js';

interface Props {
	ddhqHost: DdhqHost | null; // null: not switchable (DDHQ off)
	mode: Mode | null;
}

// Live mode's editable DDHQ query list — one /api/v4/races query string per line — and
// which DDHQ host it runs against. In Sim both are set aside: the simulator names the races
// it's serving and DDHQ is its mirror. Both are runtime state on the server; the poller
// picks up edits on its next tick. The host isn't copied locally: the server's value
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

	const switchHost = (next: DdhqHost | null): void => {
		if (next === null || next === props.ddhqHost) return;
		api
			.setDdhqHost(next)
			.then(() => setMsg(`switched to ${next} — takes effect on the next poll`))
			.catch((e: unknown) =>
				setMsg(e instanceof Error ? `switch failed: ${e.message}` : 'switch failed'),
			);
	};

	return (
		<Box>
			{props.mode === 'sim' && (
				<Typography
					color="warning.main"
					sx={{ borderLeft: 3, display: 'block', mb: 2, pl: 1.5 }}
					variant="body2"
				>
					Sim mode: DDHQ is the simulator's mirror, polled for the races the simulator names. This
					list and host are Live's, kept for when you switch back.
				</Typography>
			)}
			{props.ddhqHost !== null && props.mode !== 'sim' && (
				<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mb: 2 }}>
					<Typography color="text.secondary" variant="caption">
						DDHQ host:
					</Typography>
					<ToggleButtonGroup
						exclusive={true}
						onChange={(_event, next: DdhqHost | null) => switchHost(next)}
						size="small"
						value={props.ddhqHost}
					>
						<ToggleButton value="production">Production</ToggleButton>
						<ToggleButton color="warning" value="integration">
							Integration (test)
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
				slotProps={{
					input: {
						sx: {
							fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
							fontSize: 13,
							maxWidth: 720,
						},
					},
				}}
				value={text}
			/>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mt: 1 }}>
				<Button onClick={() => void save()} size="small" variant="contained">
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
