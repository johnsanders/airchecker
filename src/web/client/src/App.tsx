import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from './api.js';
import type { RaceSummary, StateResponse } from './api.js';
import Alerts from './components/Alerts.js';
import CapturePanel from './components/CapturePanel.js';
import QueryEditor from './components/QueryEditor.js';
import RaceDetail from './components/RaceDetail.js';
import RaceList from './components/RaceList.js';
import SourceHealth from './components/SourceHealth.js';
import { usePolling } from './usePolling.js';

const Section: React.FC<{ children: React.ReactNode; title: string }> = (props) => (
  <Paper sx={{ p: 2, height: '100%' }}>
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: 'block', mb: 1, letterSpacing: '.06em' }}
    >
      {props.title}
    </Typography>
    {props.children}
  </Paper>
);

const App: React.FC = () => {
  const { data: state } = usePolling<StateResponse>(() => api.getState(), 2500);
  const { data: racesData } = usePolling<{ races: RaceSummary[] }>(() => api.getRaces(), 2500);
  const [selected, setSelected] = React.useState<string | undefined>(undefined);

  const races = racesData?.races ?? [];
  // Default selection to the first race once data arrives.
  React.useEffect(() => {
    if (selected === undefined && races.length > 0) setSelected(races[0]!.raceKey);
  }, [races, selected]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar variant="dense">
          <Typography sx={{ fontWeight: 700 }}>Eagle Eye</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            election-graphics observer · live
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ p: 2 }}>
        <Box sx={{ mb: 2 }}>
          <SourceHealth sources={state?.sources ?? []} />
        </Box>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Section title="Races">
              <RaceList races={races} selected={selected} onSelect={setSelected} />
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            <Section title="Race detail">
              {selected ? (
                <RaceDetail raceKey={selected} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Select a race to compare sources.
                </Typography>
              )}
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Alerts">
              <Alerts alerts={state?.alerts ?? []} onSelectRace={setSelected} />
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Section title="Actus capture">
              <CapturePanel cadence={state?.cadence ?? null} lastFrame={state?.lastFrame ?? null} />
            </Section>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Section title="DDHQ queries">
              <QueryEditor />
            </Section>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default App;
