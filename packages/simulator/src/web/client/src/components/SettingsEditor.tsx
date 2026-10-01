import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';

// What the recorder polls: the DDHQ query list (one /api/v4/races query string per
// line), asked of DDHQ's integration host, and how often. Saved edits land on the
// recorder's next check; a new interval, after the wait already underway.
const SettingsEditor: React.FC = () => {
	const [text, setText] = React.useState('');
	const [intervalText, setIntervalText] = React.useState('60');
	const [msg, setMsg] = React.useState('');

	React.useEffect(() => {
		void api.getSettings().then((settings) => {
			setText(settings.queries.join('\n'));
			setIntervalText(String(settings.intervalSeconds));
		});
	}, []);

	const save = async (): Promise<void> => {
		try {
			// Refetched, not the settings this loaded with: AirPanel's airSource toggle writes
			// the same object, and a stale copy of it here would clobber that.
			const latest = await api.getSettings();
			const saved = await api.setSettings({
				...latest,
				intervalSeconds: Number(intervalText),
				queries: text.split('\n'),
			});
			setText(saved.queries.join('\n'));
			setIntervalText(String(saved.intervalSeconds));
			setMsg(`saved ${saved.queries.length}, every ${saved.intervalSeconds} s`);
		} catch (error) {
			setMsg(error instanceof Error ? `save failed: ${error.message}` : 'save failed');
		}
	};

	return (
		<Box>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 2, mb: 1.5 }}>
				<Typography color="text.secondary" variant="body2">
					DDHQ queries, asked of its integration host (resultsapi-integration.decisiondeskhq.com)
				</Typography>
				<TextField
					label="Sample every (s)"
					onChange={(event) => setIntervalText(event.target.value)}
					size="small"
					slotProps={{ htmlInput: { max: 3600, min: 5, step: 1 } }}
					sx={{ ml: 'auto', width: 140 }}
					type="number"
					value={intervalText}
				/>
			</Box>
			<TextField
				fullWidth={true}
				minRows={3}
				multiline={true}
				onChange={(event) => setText(event.target.value)}
				placeholder={'race_ids=123,456\nstate=TX&office_id=3'}
				slotProps={{
					input: {
						sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
					},
				}}
				value={text}
			/>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mt: 1 }}>
				<Button onClick={() => void save()} size="small" variant="contained">
					Save
				</Button>
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Box>
		</Box>
	);
};

export default SettingsEditor;
