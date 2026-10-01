import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AlertEvent } from '../api.js';

import { api } from '../api.js';
import { ago, SEVERITY_COLOR } from '../format.js';
import { useLiveQuery } from '../useLiveQuery.js';

interface Props {
	onSelectRace: (raceKey: string) => void;
}

// The append-only feed of what air reads found, newest first: a finding is raised when a
// read has it and the previous read of that race on that graphic didn't, and cleared when
// a later one no longer does. It outlasts the list, which holds 30 minutes.
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
		<Box sx={{ maxHeight: 'calc(100vh - 240px)', minHeight: 120, overflowY: 'auto' }}>
			{events.map((event) => (
				<Box
					key={`${event.ts}-${event.kind}-${event.type}-${event.raceKey}-${event.subject ?? ''}`}
					onClick={() => props.onSelectRace(event.raceKey)}
					sx={{
						'&:hover': { bgcolor: 'action.hover' },
						'&:last-of-type': { borderBottom: 0 },
						alignItems: 'baseline',
						borderBottom: '1px solid',
						borderColor: 'divider',
						cursor: 'pointer',
						display: 'flex',
						gap: 1,
						mx: -1,
						px: 1,
						py: 0.75,
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
						color={event.kind === 'raised' ? SEVERITY_COLOR[event.severity] : 'default'}
						label={event.kind}
						size="small"
						sx={{ fontSize: 11, height: 20, minWidth: 60 }}
						variant={event.kind === 'raised' ? 'filled' : 'outlined'}
					/>
					<Box sx={{ minWidth: 0 }}>
						<Typography noWrap={true} sx={{ fontSize: 13, fontWeight: 600 }}>
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
