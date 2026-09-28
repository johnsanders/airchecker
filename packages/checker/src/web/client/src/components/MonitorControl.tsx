import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { SessionStatus } from '../api.js';

import { api } from '../api.js';

type Props = { status: null | SessionStatus };

// Monitoring on/off. Stop closes the session recording and halts DDHQ/Ross polling and
// air capture; Start opens a new session. Stop asks twice since it's in the toolbar on
// every tab and would silently end a broadcast's recording.
const MonitorControl: React.FC<Props> = (props) => {
	const [confirming, setConfirming] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');

	const run = async (action: () => Promise<SessionStatus>): Promise<void> => {
		setConfirming(false);
		setBusy(true);
		try {
			await action();
			setError('');
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'failed');
		}
		setBusy(false);
	};

	if (props.status === null) return null;

	return (
		<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, ml: 'auto' }}>
			<Typography
				color={props.status.running ? 'success.main' : 'text.secondary'}
				sx={{ fontWeight: 700 }}
				variant="caption"
			>
				{props.status.running ? '● Monitoring' : '○ Stopped'}
			</Typography>
			{props.status.id !== null && (
				<Typography color="text.secondary" sx={{ fontFamily: 'monospace' }} variant="caption">
					{props.status.id}
				</Typography>
			)}
			{error !== '' && (
				<Typography color="error" variant="caption">
					{error}
				</Typography>
			)}
			{!props.status.running ? (
				<Button
					disabled={busy}
					onClick={() => void run(api.startSession)}
					size="small"
					variant="contained"
				>
					Start
				</Button>
			) : confirming ? (
				<>
					<Button
						color="error"
						disabled={busy}
						onClick={() => void run(api.stopSession)}
						size="small"
						variant="contained"
					>
						Stop session
					</Button>
					<Button onClick={() => setConfirming(false)} size="small">
						Cancel
					</Button>
				</>
			) : (
				<Button color="error" onClick={() => setConfirming(true)} size="small">
					Stop
				</Button>
			)}
		</Box>
	);
};

export default MonitorControl;
