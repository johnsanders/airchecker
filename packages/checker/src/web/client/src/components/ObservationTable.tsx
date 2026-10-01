import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import React from 'react';

import type { Observation } from '../api.js';

import { sourceLabel } from '../api.js';
import { clockTime, graphicLabel, pct } from '../format.js';

interface Props {
	observations: Observation[];
}

const pctIn = (observation: Observation): string =>
	`${observation.pctInIsMinimum === true ? '>' : ''}${pct(observation.pctIn)}%`;

// One row per observation: when, where from, % in, and each candidate's percent, votes and ✓.
const ObservationTable: React.FC<Props> = (props) => (
	<Box sx={{ maxHeight: 600, overflowY: 'auto' }}>
		<Table size="small" stickyHeader={true}>
			<TableHead>
				<TableRow>
					<TableCell>Time</TableCell>
					<TableCell>Source</TableCell>
					<TableCell>Graphic</TableCell>
					<TableCell align="right">% in</TableCell>
					<TableCell>Candidates</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{props.observations.map((observation) => (
					<TableRow
						key={`${observation.observedAt} ${observation.source} ${observation.templateId ?? ''} ${observation.raceKey}`}
					>
						<TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
							{clockTime(observation.observedAt)}
						</TableCell>
						<TableCell sx={{ whiteSpace: 'nowrap' }}>{sourceLabel(observation.source)}</TableCell>
						<TableCell>
							{observation.source === 'air' ? graphicLabel(observation.templateId) : ''}
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
