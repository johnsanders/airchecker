import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import React from 'react';

import type { Anomaly } from '../api.js';
import { ago } from '../usePolling.js';

interface Props {
  alerts: Anomaly[];
  onSelectRace: (raceKey: string) => void;
}

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEV_COLOR: Record<string, 'error' | 'warning' | 'default'> = {
  high: 'error',
  medium: 'warning',
  low: 'default',
};

// Alerts grouped by race, severity-sorted (high first), each group expandable. The
// header chip shows the worst severity in the group + count; clicking a row jumps
// to that race's detail.
const Alerts: React.FC<Props> = (props) => {
  if (props.alerts.length === 0)
    return (
      <Typography variant="body2" color="text.secondary">
        No alerts. (Cross-source alerts appear once two sources overlap on a race.)
      </Typography>
    );

  const byRace = new Map<string, Anomaly[]>();
  props.alerts.forEach((a) => {
    const list = byRace.get(a.raceKey) ?? [];
    list.push(a);
    byRace.set(a.raceKey, list);
  });
  const groups = Array.from(byRace.entries()).sort((a, b) => {
    const worst = (xs: Anomaly[]) => Math.min(...xs.map((x) => SEV_ORDER[x.severity] ?? 3));
    return worst(a[1]) - worst(b[1]);
  });

  return (
    <Box>
      {groups.map(([raceKey, alerts]) => {
        const worst = alerts.reduce(
          (acc, a) => ((SEV_ORDER[a.severity] ?? 3) < (SEV_ORDER[acc] ?? 3) ? a.severity : acc),
          'low',
        );
        return (
          <Accordion key={raceKey} disableGutters sx={{ bgcolor: 'background.paper' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Chip size="small" color={SEV_COLOR[worst] ?? 'default'} label={alerts.length} sx={{ mr: 1.5 }} />
              <Typography noWrap sx={{ flex: 1, fontSize: 13 }}>
                {raceKey}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {alerts.map((a, i) => (
                <Box
                  key={i}
                  sx={{ mb: 1, cursor: 'pointer' }}
                  onClick={() => props.onSelectRace(raceKey)}
                >
                  <Typography variant="body2" sx={{ color: `${SEV_COLOR[a.severity] ?? 'text'}.light` }}>
                    [{a.severity}] {a.type}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {a.detail} · {ago(a.observedAt)}
                  </Typography>
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
};

export default Alerts;
