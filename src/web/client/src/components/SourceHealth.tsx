import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { SourceStat } from '../api.js';

import { sourceLabel } from '../api.js';
import { ago } from '../format.js';

interface Props {
	sources: SourceStat[];
}

// Per-source health: green when it has data and was seen recently, red/grey when
// stale or empty. The at-a-glance "is everything flowing" row.
const isHealthy = (s: SourceStat): boolean => s.lastAt !== null && Date.now() - s.lastAt < 120_000;

const SourceHealth: React.FC<Props> = (props) => (
	<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
		{props.sources.map((s) => (
			<Paper key={s.source} sx={{ flex: '1 1 160px', minWidth: 160, p: 1.5 }}>
				<Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
					<Typography sx={{ fontWeight: 600 }}>{sourceLabel(s.source)}</Typography>
					<Chip
						color={isHealthy(s) ? 'success' : s.observations > 0 ? 'warning' : 'default'}
						label={isHealthy(s) ? 'live' : s.observations > 0 ? 'stale' : 'idle'}
						size="small"
					/>
				</Box>
				<Typography color="text.secondary" variant="body2">
					{s.races} races · {s.observations} obs
				</Typography>
				<Typography color="text.secondary" variant="caption">
					last {ago(s.lastAt)}
				</Typography>
			</Paper>
		))}
	</Box>
);

export default SourceHealth;
