import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import React from 'react';

import { sourceLabel } from '../api.js';
import type { SourceStat } from '../api.js';
import { ago } from '../usePolling.js';

interface Props {
  sources: SourceStat[];
}

// Per-source health: green when it has data and was seen recently, red/grey when
// stale or empty. The at-a-glance "is everything flowing" row.
const isHealthy = (s: SourceStat): boolean =>
  s.lastAt !== null && Date.now() - s.lastAt < 120_000;

const SourceHealth: React.FC<Props> = (props) => (
  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
    {props.sources.map((s) => (
      <Paper key={s.source} sx={{ p: 1.5, flex: '1 1 160px', minWidth: 160 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 600 }}>{sourceLabel(s.source)}</Typography>
          <Chip
            size="small"
            label={isHealthy(s) ? 'live' : s.observations > 0 ? 'stale' : 'idle'}
            color={isHealthy(s) ? 'success' : s.observations > 0 ? 'warning' : 'default'}
          />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {s.races} races · {s.observations} obs
        </Typography>
        <Typography variant="caption" color="text.secondary">
          last {ago(s.lastAt)}
        </Typography>
      </Paper>
    ))}
  </Box>
);

export default SourceHealth;
