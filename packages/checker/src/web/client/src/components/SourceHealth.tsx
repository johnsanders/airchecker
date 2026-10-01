import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { SourceStat } from '../api.js';

import { sourceLabel } from '../api.js';
import { ago } from '../format.js';

interface Props {
	sources: SourceStat[];
}

// Per-source health: green when it has data and was seen recently, red when its
// poll/capture is currently failing (with the reason), amber/grey when stale or empty.
// The at-a-glance "is everything flowing" row.
const isHealthy = (s: SourceStat): boolean => s.lastAt !== null && Date.now() - s.lastAt < 120_000;

type Status = 'failing' | 'idle' | 'live' | 'stale';

const status = (s: SourceStat): Status =>
	s.error !== null ? 'failing' : isHealthy(s) ? 'live' : s.observations > 0 ? 'stale' : 'idle';

const TALLY: Record<Status, string> = {
	failing: 'error.main',
	idle: 'text.disabled',
	live: 'success.main',
	stale: 'warning.main',
};

// A strip of tally lights under the app bar, one segment per source; a failing source's
// reason gets its own line so it can't be missed or truncated.
const SourceHealth: React.FC<Props> = (props) => (
	<Box sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', mb: 1 }}>
		<Box sx={{ display: 'flex', flexWrap: 'wrap', px: 2 }}>
			{props.sources.map((s) => (
				<Box
					key={s.source}
					sx={{
						'&:first-of-type': { pl: 0 },
						'&:last-of-type': { borderRight: 0 },
						alignItems: 'baseline',
						borderRight: { sm: 1 },
						borderRightColor: 'divider',
						columnGap: 1.5,
						display: 'flex',
						flex: '1 1 240px',
						flexWrap: 'wrap',
						px: { sm: 2, xs: 0 },
						py: 1,
					}}
				>
					<Box
						sx={{
							alignSelf: 'center',
							bgcolor: TALLY[status(s)],
							borderRadius: '50%',
							boxShadow: status(s) === 'idle' ? 'none' : '0 0 8px currentColor',
							color: TALLY[status(s)],
							flex: 'none',
							height: 9,
							width: 9,
						}}
					/>
					<Typography sx={{ fontSize: 14, fontWeight: 700 }}>{sourceLabel(s.source)}</Typography>
					<Typography sx={{ color: TALLY[status(s)], fontSize: 13, fontWeight: 600 }}>
						{status(s)}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						{s.races} races · {s.observations} obs · last {ago(s.lastAt)}
					</Typography>
				</Box>
			))}
		</Box>
		{props.sources
			.filter((s) => s.error !== null)
			.map((s) => (
				<Typography
					color="error"
					key={s.source}
					sx={{
						bgcolor: 'rgba(255, 90, 82, .1)',
						borderTop: 1,
						borderTopColor: 'rgba(255, 90, 82, .3)',
						px: 2,
						py: 0.75,
						wordBreak: 'break-word',
					}}
					variant="body2"
				>
					<b>{sourceLabel(s.source)} failing:</b> {s.error?.message}
					<Typography color="text.secondary" component="span" variant="caption">
						{' '}
						· {s.error?.count}× since {ago(s.error?.since)}
					</Typography>
				</Typography>
			))}
	</Box>
);

export default SourceHealth;
