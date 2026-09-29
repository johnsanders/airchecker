import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { AirRead, SourceName } from '../api.js';

import { sourceLabel } from '../api.js';
import { clockTime, graphicLabel, pct, SEVERITY_COLOR, SEVERITY_ORDER } from '../format.js';

interface Props {
	onSelect?: (raceKey: string) => void; // rows open their race when given
	reads: AirRead[];
}

// What was on screen, then back up the chain that fed it.
const SOURCES: SourceName[] = ['air', 'Ross', 'DDHQ'];

// Every line of a row's candidate and source cells is one of these, so the % in line and
// each candidate's line sit level across the columns.
const LINE = { fontSize: 12, lineHeight: '20px', whiteSpace: 'nowrap' } as const;

const SourceCell: React.FC<{ read: AirRead; source: SourceName }> = (props) => {
	const pctIn = props.read.pctIn[props.source];
	const saidAt = props.read.saidAt[props.source];
	if (pctIn === null)
		return (
			<Typography color="text.secondary" sx={LINE}>
				—
			</Typography>
		);
	return (
		<Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
			<Typography sx={LINE}>
				{props.source === 'air' && props.read.pctInIsMinimum ? '>' : ''}
				{pct(pctIn)}%
			</Typography>
			{props.read.candidates.map((candidate) => {
				const cell = candidate.cells[props.source];
				return (
					<Typography key={candidate.name} sx={LINE}>
						{cell === undefined
							? '—'
							: `${cell.votes.toLocaleString('en-US')} · ${pct(cell.pct)}%${cell.called ? ' ✓' : ''}`}
					</Typography>
				);
			})}
			{props.source !== 'air' && saidAt !== null && (
				<Typography color="text.secondary" sx={LINE}>
					since {clockTime(saidAt)}
				</Typography>
			)}
		</Box>
	);
};

const Check: React.FC<{ read: AirRead }> = (props) => {
	if (props.read.anomalies.length > 0)
		return (
			<Box>
				{props.read.anomalies.map((anomaly) => (
					<Box key={`${anomaly.type} ${anomaly.detail}`} sx={{ mb: 0.5 }}>
						<Chip
							color={SEVERITY_COLOR[anomaly.severity]}
							label={anomaly.type}
							size="small"
							sx={{ fontSize: 10, height: 18, mr: 1 }}
						/>
						<Typography color="text.secondary" variant="caption">
							{anomaly.detail}
						</Typography>
					</Box>
				))}
			</Box>
		);
	if (!props.read.linked)
		return (
			<Typography color="warning.main" variant="caption">
				heading fits no one race from DDHQ or Ross, so not compared
			</Typography>
		);
	if (props.read.pctIn.Ross === null && props.read.pctIn.DDHQ === null)
		return (
			<Typography color="warning.main" variant="caption">
				no Ross or DDHQ data at the time of the read
			</Typography>
		);
	return (
		<Typography color="text.secondary" variant="caption">
			no alerts
		</Typography>
	);
};

const worstSeverityColor = (read: AirRead): string => {
	const worst = [...read.anomalies].sort(
		(left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
	)[0];
	return worst === undefined ? 'transparent' : `${SEVERITY_COLOR[worst.severity]}.main`;
};

// Graphics read off the screen, newest first. Each row is a record of one read: the
// graphic's numbers, the Ross state it was held against, what DDHQ was saying, and what
// was found wrong. The Live tab lists each race once, as its latest read; a race's dialog
// lists every read of it.
const AirReadTable: React.FC<Props> = (props) => {
	if (props.reads.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				Nothing read off air yet.
			</Typography>
		);
	return (
		<Table size="small" sx={{ '& td, & th': { verticalAlign: 'top' } }}>
			<TableHead>
				<TableRow>
					<TableCell>Aired</TableCell>
					<TableCell>Race</TableCell>
					<TableCell>Candidate</TableCell>
					{SOURCES.map((source) => (
						<TableCell key={source}>{sourceLabel(source)}</TableCell>
					))}
					<TableCell>Check</TableCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{props.reads.map((read) => (
					<TableRow
						hover={props.onSelect !== undefined}
						key={`${read.raceKey} ${read.airedAt} ${read.templateId ?? ''}`}
						onClick={() => props.onSelect?.(read.raceKey)}
						sx={props.onSelect === undefined ? {} : { cursor: 'pointer' }}
					>
						<TableCell
							sx={{
								borderLeft: '3px solid',
								borderLeftColor: worstSeverityColor(read),
								whiteSpace: 'nowrap',
							}}
						>
							<Typography sx={{ ...LINE, fontFamily: 'monospace' }}>
								{clockTime(read.airedAt)}
							</Typography>
							<Typography color="text.secondary" sx={LINE}>
								{graphicLabel(read.templateId)}
							</Typography>
						</TableCell>
						<TableCell sx={{ maxWidth: 280 }}>
							<Typography sx={{ fontSize: 13 }}>{read.heading}</Typography>
							{read.linked && (
								<Typography
									color="text.secondary"
									sx={{ display: 'block', wordBreak: 'break-all' }}
									variant="caption"
								>
									{read.raceKey}
								</Typography>
							)}
							{!read.linked && (
								<Chip
									color="warning"
									label="not linked"
									size="small"
									sx={{ fontSize: 10, height: 18 }}
								/>
							)}
						</TableCell>
						<TableCell>
							<Typography color="text.secondary" sx={LINE}>
								% in
							</Typography>
							{read.candidates.map((candidate) => (
								<Typography key={candidate.name} sx={LINE}>
									{candidate.name} ({candidate.party})
								</Typography>
							))}
						</TableCell>
						{SOURCES.map((source) => (
							<TableCell key={source}>
								<SourceCell read={read} source={source} />
							</TableCell>
						))}
						<TableCell sx={{ maxWidth: 360 }}>
							<Check read={read} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
};

export default AirReadTable;
