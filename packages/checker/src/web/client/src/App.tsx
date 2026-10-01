import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AirRead, StateResponse } from './api.js';

import { api } from './api.js';
import AirReadTable from './components/AirReadTable.js';
import AlertHistory from './components/AlertHistory.js';
import BackendBanner from './components/BackendBanner.js';
import CapturePanel from './components/CapturePanel.js';
import ModeSwitch from './components/ModeSwitch.js';
import MonitorControl from './components/MonitorControl.js';
import QueryEditor from './components/QueryEditor.js';
import RaceDetailDialog from './components/RaceDetailDialog.js';
import SessionsPanel from './components/SessionsPanel.js';
import SourceHealth from './components/SourceHealth.js';
import { COLORS } from './theme.js';
import { useLiveQuery } from './useLiveQuery.js';

const Section: React.FC<{
	action?: React.ReactNode;
	children: React.ReactNode;
	count?: number;
	title: string;
}> = (props) => (
	<Paper sx={{ height: '100%', overflowX: 'auto', p: 2 }} variant="outlined">
		<Box sx={{ alignItems: 'center', display: 'flex', gap: 2, mb: 1.5, minHeight: 32 }}>
			<Typography component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>
				{props.title}
				{props.count !== undefined && (
					<Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, ml: 1 }}>
						{props.count}
					</Box>
				)}
			</Typography>
			<Box sx={{ ml: 'auto' }}>{props.action}</Box>
		</Box>
		{props.children}
	</Paper>
);

const TABS = ['live', 'air', 'setup', 'sessions'] as const;
type TabId = (typeof TABS)[number];

const tabFromHash = (): TabId => TABS.find((tab) => `#${tab}` === window.location.hash) ?? 'live';

const TabLabel: React.FC<{ count: number; label: string }> = (props) => (
	<Badge
		badgeContent={props.count}
		color="error"
		sx={{ '& .MuiBadge-badge': { fontWeight: 700, right: -14 } }}
	>
		{props.label}
	</Badge>
);

const App: React.FC = () => {
	const { data: state } = useLiveQuery<StateResponse>(() => api.getState());
	const { data: racesData } = useLiveQuery<{ races: AirRead[] }>(() => api.getRaces());
	const [selected, setSelected] = React.useState<string | undefined>(undefined);
	const [alertsOnly, setAlertsOnly] = React.useState(false);
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
	const withAlerts = races.filter((read) => read.anomalies.length > 0);
	const simulating = state?.mode === 'sim';

	return (
		<Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
			<BackendBanner />
			{/* Sim turns the whole bar amber, so a rehearsal can't be mistaken for air. */}
			<AppBar
				elevation={0}
				position="static"
				sx={{
					bgcolor: simulating ? 'warning.main' : 'background.paper',
					borderBottom: 1,
					borderColor: simulating ? 'warning.main' : 'divider',
					color: simulating ? COLORS.console : 'text.primary',
				}}
			>
				<Toolbar sx={{ flexWrap: 'wrap', gap: 1, minHeight: { xs: 56 }, px: { xs: 2 } }}>
					<Typography
						sx={{ fontSize: 18, fontStretch: '118%', fontWeight: 800, letterSpacing: '-.01em' }}
					>
						Eagle Eye
					</Typography>
					<Typography
						sx={{ fontWeight: simulating ? 700 : 400, ml: 1.5, opacity: simulating ? 1 : 0.7 }}
						variant="body2"
					>
						{simulating
							? 'Simulation: watching the simulator, not air'
							: 'election-graphics observer'}
					</Typography>
					<ModeSwitch
						mode={state?.mode ?? null}
						monitoring={state?.session?.running ?? false}
						onAmber={simulating}
					/>
					<MonitorControl onAmber={simulating} status={state?.session ?? null} />
				</Toolbar>
			</AppBar>

			<SourceHealth sources={state?.sources ?? []} />

			<Box sx={{ px: 2 }}>
				<Tabs
					onChange={(_event, value: TabId) => selectTab(value)}
					sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
					value={tab}
					variant="scrollable"
				>
					<Tab label={<TabLabel count={withAlerts.length} label="Live" />} value="live" />
					<Tab label="Air capture" value="air" />
					<Tab label="Setup" value="setup" />
					<Tab label="Session recordings" value="sessions" />
				</Tabs>

				<Box hidden={tab !== 'live'} sx={{ pb: 2 }}>
					{/* The alert feed sits beside the reads where there's room, so it's never below the fold. */}
					<Box
						sx={{
							alignItems: 'start',
							display: 'grid',
							gap: 2,
							gridTemplateColumns: { lg: 'minmax(0, 1fr) 360px', xs: 'minmax(0, 1fr)' },
						}}
					>
						<Section
							action={
								<FormControlLabel
									control={
										<Switch
											checked={alertsOnly}
											onChange={(_event, checked) => setAlertsOnly(checked)}
											size="small"
										/>
									}
									label={`Only the ${withAlerts.length} with alerts`}
									slotProps={{ typography: { variant: 'body2' } }}
									sx={{ mr: 0 }}
								/>
							}
							count={races.length}
							title="On air"
						>
							<AirReadTable onSelect={setSelected} reads={alertsOnly ? withAlerts : races} />
						</Section>

						<Box sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}>
							<Section title="Recent alert events">
								<AlertHistory onSelectRace={setSelected} />
							</Section>
						</Box>
					</Box>
				</Box>

				<Box hidden={tab !== 'air'} sx={{ pb: 2 }}>
					<Section title="Air capture">
						<CapturePanel
							airMatch={state?.airMatch ?? null}
							cadence={state?.cadence ?? null}
							lastFrame={state?.lastFrame ?? null}
							mode={state?.mode ?? null}
						/>
					</Section>
				</Box>

				<Box hidden={tab !== 'setup'} sx={{ pb: 2 }}>
					<Section title="DDHQ queries">
						<QueryEditor ddhqHost={state?.ddhqHost ?? null} mode={state?.mode ?? null} />
					</Section>
				</Box>

				<Box hidden={tab !== 'sessions'} sx={{ pb: 2 }}>
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
