import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';

interface Props {
	readOnly: boolean; // API playback: the recording fixes the query list
}

// Editable DDHQ query list — one /api/v4/races query string per line. Runtime
// state on the server (queryStore); the poller picks up edits on its next tick.
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

	return (
		<Box>
			<TextField
				disabled={props.readOnly}
				fullWidth
				minRows={3}
				multiline
				onChange={(e) => setText(e.target.value)}
				placeholder={'race_ids=123,456\nstate=TX&office_id=3'}
				slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
				value={text}
			/>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, mt: 1 }}>
				<Button
					disabled={props.readOnly}
					onClick={() => void save()}
					size="small"
					variant="outlined"
				>
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
