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
	<Paper sx={{ mb: 2, p: 2 }}>
		<Typography
			color="text.secondary"
			sx={{ display: 'block', letterSpacing: '.06em', mb: 1 }}
			variant="overline"
		>
			{props.title}
		</Typography>
		{props.children}
	</Paper>
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
			<AppBar color="default" elevation={0} position="static">
				<Toolbar variant="dense">
					<Typography sx={{ fontWeight: 700 }}>Simulator</Typography>
					<Typography color="text.secondary" sx={{ ml: 2 }} variant="caption">
						election API recorder + playback ·{' '}
						{status === undefined || status.playback === null
							? 'idle'
							: `playing ${status.playback.name}`}
					</Typography>
					{status !== undefined && status.recording !== null && (
						<Typography color="error" sx={{ fontWeight: 700, ml: 2 }} variant="caption">
							● REC
						</Typography>
					)}
				</Toolbar>
			</AppBar>
			<Box sx={{ p: 2 }}>
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
