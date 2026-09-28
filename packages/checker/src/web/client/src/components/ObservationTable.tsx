import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import React from 'react';

import type { Observation } from '../api.js';

import { sourceLabel } from '../api.js';
import { pct } from '../format.js';

interface Props {
	observations: Observation[];
	onSelect?: (observation: Observation) => void;
	show: 'race' | 'source'; // the column that tells rows apart: the race (air reads) or the source (one race)
}

const GRAPHIC_LABELS: Record<string, string> = {
	fullscreen_results: 'FS',
	lower_third: 'L3',
	ticker_v1: 'Ticker',
};

const time = (ts: number): string => new Date(ts).toLocaleTimeString('en-US', { hour12: false });

const pctIn = (observation: Observation): string =>
	`${observation.pctInIsMinimum === true ? '>' : ''}${pct(observation.pctIn)}%`;

// One row per observation: when, where from, % in, and each candidate's percent, votes and ✓.
const ObservationTable: React.FC<Props> = (props) => (
	<Box sx={{ maxHeight: 600, overflowY: 'auto' }}>
		<Table size="small" stickyHeader={true}>
			<TableHead>
				<TableRow>
					<TableCell>Time</TableCell>
					<TableCell>{props.show === 'race' ? 'Race' : 'Source'}</TableCell>
					<TableCell>Graphic</TableCell>
					<TableCell align="right">% in</TableCell>
					<TableCell>Candidates</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{props.observations.map((observation) => (
					<TableRow
						hover={props.onSelect !== undefined}
						key={`${observation.observedAt} ${observation.source} ${observation.templateId ?? ''} ${observation.raceKey}`}
						onClick={() => props.onSelect?.(observation)}
						sx={props.onSelect === undefined ? {} : { cursor: 'pointer' }}
					>
						<TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
							{time(observation.observedAt)}
						</TableCell>
						<TableCell sx={{ whiteSpace: 'nowrap' }}>
							{props.show === 'race'
								? (observation.sourceRaceKey ?? observation.raceKey)
								: sourceLabel(observation.source)}
						</TableCell>
						<TableCell>
							{observation.source === 'air'
								? (GRAPHIC_LABELS[observation.templateId ?? ''] ?? observation.templateId ?? '—')
								: ''}
						</TableCell>
						<TableCell align="right">{pctIn(observation)}</TableCell>
						<TableCell>
							{observation.candidates.map((candidate) => (
								<Box component="span" key={candidate.key} sx={{ mr: 2, whiteSpace: 'nowrap' }}>
									{observation.calledFor.includes(candidate.key) ? '✓ ' : ''}
									{candidate.name} ({candidate.party}) {pct(candidate.pct)}% ·{' '}
									{candidate.votes.toLocaleString('en-US')}
								</Box>
							))}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	</Box>
);

export default ObservationTable;
