import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import React from 'react';

import { sourceLabel } from '../api.js';
import type { RaceSummary, SourceName } from '../api.js';
import { ago } from '../usePolling.js';

interface Props {
  onSelect: (raceKey: string) => void;
  races: RaceSummary[];
  selected: string | undefined;
}

const SOURCES: SourceName[] = ['DDHQ', 'Ross', 'air'];

// The race list: each row shows which sources have data (colored chips) and an
// alert badge. Clicking selects it for the detail comparison.
const RaceList: React.FC<Props> = (props) => {
  if (props.races.length === 0)
    return (
      <Typography variant="body2" color="text.secondary">
        No races yet. Add DDHQ queries, enable Chameleon, or capture a frame.
      </Typography>
    );
  return (
    <List dense disablePadding>
      {props.races.map((race) => (
        <ListItemButton
          key={race.raceKey}
          selected={race.raceKey === props.selected}
          onClick={() => props.onSelect(race.raceKey)}
          sx={{ borderRadius: 1, mb: 0.5 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13 }}>
              {race.raceKey}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
              {SOURCES.map((s) => (
                <Chip
                  key={s}
                  size="small"
                  label={sourceLabel(s)}
                  variant={race.present[s] ? 'filled' : 'outlined'}
                  color={race.present[s] ? 'primary' : 'default'}
                  sx={{ height: 18, fontSize: 10, opacity: race.present[s] ? 1 : 0.4 }}
                />
              ))}
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                {ago(race.lastAt)}
              </Typography>
            </Box>
          </Box>
          {race.alertCount > 0 && (
            <Badge badgeContent={race.alertCount} color="error" sx={{ ml: 2, mr: 1 }} />
          )}
        </ListItemButton>
      ))}
    </List>
  );
};

export default RaceList;
