import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Status } from './api.js';

import { api } from './api.js';
import AirPanel from './components/AirPanel.js';
import RecordPanel from './components/RecordPanel.js';
import SettingsEditor from './components/SettingsEditor.js';

// Status is small; polling it keeps the playback position and response counts current
// without a push channel.
const STATUS_REFRESH_MS = 1_000;

const Section: React.FC<{ children: React.ReactNode; title: string }> = (props) => (
	<Paper sx={{ mb: 2, overflowX: 'auto', p: 2 }} variant="outlined">
		<Typography component="h2" sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>
			{props.title}
		</Typography>
		{props.children}
	</Paper>
);

// A lit tally for what's live: red while recording, green while something is on air.
const Tally: React.FC<{ color: string; label: string }> = (props) => (
	<Box
		sx={{
			alignItems: 'center',
			color: props.color,
			display: 'flex',
			fontSize: 13,
			fontWeight: 700,
			gap: 0.75,
		}}
	>
		<Box
			sx={{
				'@keyframes tally': { '50%': { opacity: 0.35 } },
				'@media (prefers-reduced-motion: reduce)': { animation: 'none' },
				animation: 'tally 2s ease-in-out infinite',
				bgcolor: 'currentColor',
				borderRadius: '50%',
				height: 10,
				width: 10,
			}}
		/>
		{props.label}
	</Box>
);

const App: React.FC = () => {
	const [status, setStatus] = React.useState<Status | undefined>(undefined);

	const reload = React.useCallback(async (): Promise<void> => {
		setStatus(await api.getStatus());
	}, []);

	React.useEffect(() => {
		void reload();
		const timer = setInterval(() => void reload(), STATUS_REFRESH_MS);
		return () => clearInterval(timer);
	}, [reload]);

	return (
		<Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
			<AppBar
				elevation={0}
				position="static"
				sx={{
					bgcolor: 'background.paper',
					borderBottom: 1,
					borderColor: 'divider',
					color: 'text.primary',
				}}
			>
				<Toolbar sx={{ flexWrap: 'wrap', gap: 1.5, minHeight: { xs: 56 }, px: { xs: 2 } }}>
					<Typography
						sx={{ fontSize: 18, fontStretch: '118%', fontWeight: 800, letterSpacing: '-.01em' }}
					>
						Simulator
					</Typography>
					<Typography color="text.secondary" variant="body2">
						election API recorder + playback ·{' '}
						{status === undefined || status.playback === null
							? 'idle'
							: `playing ${status.playback.name}`}
					</Typography>
					<Box sx={{ display: 'flex', gap: 2, ml: 'auto' }}>
						{(status?.air ?? null) !== null && <Tally color="success.main" label="On air" />}
						{status !== undefined && status.recording !== null && (
							<Tally color="error.main" label="REC" />
						)}
					</Box>
				</Toolbar>
			</AppBar>
			<Box sx={{ maxWidth: 1400, p: 2 }}>
				<Section title="Simulated air">
					<AirPanel onChange={reload} status={status} />
				</Section>
				<Section title="API recordings">
					<RecordPanel onChange={reload} status={status} />
				</Section>
				<Section title="What to record">
					<SettingsEditor />
				</Section>
			</Box>
		</Box>
	);
};

export default App;
