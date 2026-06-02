import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceSummary, StateResponse } from './api.js';

import { api } from './api.js';
import Alerts from './components/Alerts.js';
import CapturePanel from './components/CapturePanel.js';
import QueryEditor from './components/QueryEditor.js';
import RaceDetailDialog from './components/RaceDetailDialog.js';
import RaceLinks from './components/RaceLinks.js';
import RaceTable from './components/RaceTable.js';
import SourceHealth from './components/SourceHealth.js';
import { useLiveQuery } from './useLiveQuery.js';

const Section: React.FC<{ children: React.ReactNode; title: string }> = (props) => (
	<Paper sx={{ height: '100%', p: 2 }}>
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
	const { data: state } = useLiveQuery<StateResponse>(() => api.getState());
	const { data: racesData } = useLiveQuery<{ races: RaceSummary[] }>(() => api.getRaces());
	const [selected, setSelected] = React.useState<string | undefined>(undefined);

	const races = racesData?.races ?? [];

	return (
		<Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
			<AppBar color="default" elevation={0} position="static">
				<Toolbar variant="dense">
					<Typography sx={{ fontWeight: 700 }}>Eagle Eye</Typography>
					<Typography color="text.secondary" sx={{ ml: 2 }} variant="caption">
						election-graphics observer · live
					</Typography>
				</Toolbar>
			</AppBar>

			<Box sx={{ p: 2 }}>
				<Box sx={{ mb: 2 }}>
					<SourceHealth sources={state?.sources ?? []} />
				</Box>

				<Grid container spacing={2}>
					<Grid size={{ xs: 12 }}>
						<Section title="Races">
							<RaceTable onSelect={setSelected} races={races} />
						</Section>
					</Grid>

					<Grid size={{ md: 6, xs: 12 }}>
						<Section title="Alerts">
							<Alerts alerts={state?.alerts ?? []} onSelectRace={setSelected} />
						</Section>
					</Grid>

					<Grid size={{ md: 6, xs: 12 }}>
						<Section title="Actus capture">
							<CapturePanel cadence={state?.cadence ?? null} lastFrame={state?.lastFrame ?? null} />
						</Section>
					</Grid>

					<Grid size={{ xs: 12 }}>
						<Section
							title={`Race links${state?.pendingLinkCount ? ` (${state.pendingLinkCount})` : ''}`}
						>
							<RaceLinks />
						</Section>
					</Grid>

					<Grid size={{ xs: 12 }}>
						<Section title="DDHQ queries">
							<QueryEditor />
						</Section>
					</Grid>
				</Grid>
			</Box>

			<RaceDetailDialog onClose={() => setSelected(undefined)} raceKey={selected} />
		</Box>
	);
};

export default App;
