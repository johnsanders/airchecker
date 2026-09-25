import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AlertEvent } from '../api.js';

import { api } from '../api.js';
import { ago } from '../format.js';
import { useLiveQuery } from '../useLiveQuery.js';

interface Props {
	onSelectRace: (raceKey: string) => void;
}

const SEV_COLOR: Record<string, 'default' | 'error' | 'warning'> = {
	high: 'error',
	low: 'default',
	medium: 'warning',
};

// The append-only feed of raise/clear transitions, newest first. Standing alerts
// clear on the next clean poll, so this is where a one-poll event stays visible.
const AlertHistory: React.FC<Props> = (props) => {
	const { data } = useLiveQuery<{ events: AlertEvent[] }>(() => api.getAlertHistory(100));
	const events = data?.events ?? [];
	if (events.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				No alert events yet this session.
			</Typography>
		);
	return (
		<Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
			{events.map((event) => (
				<Box
					key={`${event.ts}-${event.kind}-${event.type}-${event.raceKey}-${event.subject ?? ''}`}
					onClick={() => props.onSelectRace(event.raceKey)}
					sx={{
						alignItems: 'baseline',
						borderBottom: '1px solid',
						borderColor: 'divider',
						cursor: 'pointer',
						display: 'flex',
						gap: 1,
						py: 0.5,
					}}
				>
					<Typography
						color="text.secondary"
						sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 64 }}
						variant="caption"
					>
						{ago(event.ts)}
					</Typography>
					<Chip
						color={event.kind === 'raised' ? (SEV_COLOR[event.severity] ?? 'default') : 'default'}
						label={event.kind}
						size="small"
						sx={{ fontSize: 10, height: 18, minWidth: 58 }}
						variant={event.kind === 'raised' ? 'filled' : 'outlined'}
					/>
					<Box sx={{ minWidth: 0 }}>
						<Typography noWrap={true} sx={{ fontSize: 12 }}>
							{event.type}
							{event.subject === undefined ? '' : ` · ${event.subject}`} — {event.raceKey}
						</Typography>
						<Typography
							color="text.secondary"
							noWrap={true}
							sx={{ display: 'block' }}
							variant="caption"
						>
							{event.detail}
						</Typography>
					</Box>
				</Box>
			))}
		</Box>
	);
};

export default AlertHistory;
