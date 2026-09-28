import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceSummary, StateResponse } from './api.js';

import { api } from './api.js';
import AlertHistory from './components/AlertHistory.js';
import Alerts from './components/Alerts.js';
import BackendBanner from './components/BackendBanner.js';
import CapturePanel from './components/CapturePanel.js';
import MonitorControl from './components/MonitorControl.js';
import QueryEditor from './components/QueryEditor.js';
import RaceDetailDialog from './components/RaceDetailDialog.js';
import RaceLinks from './components/RaceLinks.js';
import RaceTable from './components/RaceTable.js';
import SessionsPanel from './components/SessionsPanel.js';
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

const TABS = ['live', 'air', 'setup', 'sessions'] as const;
type TabId = (typeof TABS)[number];

const tabFromHash = (): TabId => TABS.find((tab) => `#${tab}` === window.location.hash) ?? 'live';

const TabLabel: React.FC<{ count: number; label: string }> = (props) => (
	<Badge badgeContent={props.count} color="error" sx={{ '& .MuiBadge-badge': { right: -12 } }}>
		{props.label}
	</Badge>
);

const App: React.FC = () => {
	const { data: state } = useLiveQuery<StateResponse>(() => api.getState());
	const { data: racesData } = useLiveQuery<{ races: RaceSummary[] }>(() => api.getRaces());
	const [selected, setSelected] = React.useState<string | undefined>(undefined);
	const [tab, setTab] = React.useState<TabId>(tabFromHash);

	React.useEffect(() => {
		const onHashChange = () => setTab(tabFromHash());
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);

	const selectTab = (next: TabId) => {
		window.location.hash = next;
		setTab(next);
	};

	const races = racesData?.races ?? [];

	return (
		<Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
			<BackendBanner />
			<AppBar color="default" elevation={0} position="static">
				<Toolbar variant="dense">
					<Typography sx={{ fontWeight: 700 }}>Eagle Eye</Typography>
					<Typography color="text.secondary" sx={{ ml: 2 }} variant="caption">
						election-graphics observer ·{' '}
						{state?.ddhqEnvironment === 'sim' ? 'sim (elex_sim)' : 'live'}
					</Typography>
					<MonitorControl status={state?.session ?? null} />
				</Toolbar>
			</AppBar>

			<Box sx={{ p: 2 }}>
				<Box sx={{ mb: 2 }}>
					<SourceHealth sources={state?.sources ?? []} />
				</Box>

				<Tabs
					onChange={(_event, value: TabId) => selectTab(value)}
					sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
					value={tab}
				>
					<Tab label={<TabLabel count={state?.alerts.length ?? 0} label="Live" />} value="live" />
					<Tab label="Air capture" value="air" />
					<Tab
						label={<TabLabel count={state?.pendingLinkCount ?? 0} label="Setup" />}
						value="setup"
					/>
					<Tab label="Session recordings" value="sessions" />
				</Tabs>

				<Box hidden={tab !== 'live'}>
					<Grid container spacing={2}>
						<Grid size={{ md: 6, xs: 12 }}>
							<Section title="Alerts">
								<Alerts alerts={state?.alerts ?? []} onSelectRace={setSelected} />
							</Section>
						</Grid>

						<Grid size={{ md: 6, xs: 12 }}>
							<Section title="Recent alert events">
								<AlertHistory onSelectRace={setSelected} />
							</Section>
						</Grid>

						<Grid size={{ xs: 12 }}>
							<Section title="Races">
								<RaceTable onSelect={setSelected} races={races} />
							</Section>
						</Grid>
					</Grid>
				</Box>

				<Box hidden={tab !== 'air'}>
					<Section title="Air capture">
						<CapturePanel
							airMatch={state?.airMatch ?? null}
							cadence={state?.cadence ?? null}
							lastFrame={state?.lastFrame ?? null}
						/>
					</Section>
				</Box>

				<Box hidden={tab !== 'setup'}>
					<Grid container spacing={2}>
						<Grid size={{ xs: 12 }}>
							<Section title="DDHQ queries">
								<QueryEditor environment={state?.ddhqEnvironment ?? null} />
							</Section>
						</Grid>

						<Grid size={{ xs: 12 }}>
							<Section
								title={`Race links${state?.pendingLinkCount ? ` (${state.pendingLinkCount})` : ''}`}
							>
								<RaceLinks />
							</Section>
						</Grid>
					</Grid>
				</Box>

				<Box hidden={tab !== 'sessions'}>
					<Section title="Session recordings">
						<SessionsPanel />
					</Section>
				</Box>
			</Box>

			<RaceDetailDialog onClose={() => setSelected(undefined)} raceKey={selected} />
		</Box>
	);
};

export default App;
