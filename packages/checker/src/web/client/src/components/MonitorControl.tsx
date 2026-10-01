import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { SessionStatus } from '../api.js';

import { api } from '../api.js';
import { COLORS } from '../theme.js';

type Props = { onAmber: boolean; status: null | SessionStatus };

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
		<Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5, ml: 'auto' }}>
			<Box
				sx={{
					alignItems: 'center',
					color: props.status.running ? (props.onAmber ? 'inherit' : 'success.main') : 'inherit',
					display: 'flex',
					fontSize: 13,
					fontWeight: 700,
					gap: 0.75,
					opacity: props.status.running ? 1 : 0.7,
				}}
			>
				<Box
					sx={{
						'@keyframes tally': { '50%': { opacity: 0.35 } },
						'@media (prefers-reduced-motion: reduce)': { animation: 'none' },
						animation: props.status.running ? 'tally 2s ease-in-out infinite' : 'none',
						bgcolor: props.status.running ? 'currentColor' : 'transparent',
						border: '2px solid currentColor',
						borderRadius: '50%',
						height: 10,
						width: 10,
					}}
				/>
				{props.status.running ? 'Monitoring' : 'Stopped'}
			</Box>
			{props.status.id !== null && (
				<Typography
					sx={{
						display: { md: 'block', xs: 'none' },
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
						fontSize: 12,
						opacity: 0.7,
					}}
				>
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
					<Button color="inherit" onClick={() => setConfirming(false)} size="small">
						Cancel
					</Button>
				</>
			) : (
				<Button
					color="error"
					onClick={() => setConfirming(true)}
					size="small"
					sx={props.onAmber ? { color: COLORS.console } : {}}
					variant="outlined"
				>
					Stop
				</Button>
			)}
		</Box>
	);
};

export default MonitorControl;
