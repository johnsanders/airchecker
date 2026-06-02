import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceSourceSummary, RaceSummary, SourceName } from '../api.js';

import { sourceLabel } from '../api.js';
import { ago } from '../format.js';

interface Props {
	onSelect: (raceKey: string) => void;
	races: RaceSummary[];
}

const SOURCES: SourceName[] = ['DDHQ', 'Ross', 'air'];
// Top N leaders per source in the overview; the rest live in the detail modal.
const CANDIDATE_CAP = 3;

// One source's column for a race: pctIn header + the leading candidates (votes·pct,
// ✓ when that source called them), with a "+N more" hint when the field is deeper.
const SourceCell: React.FC<{ summary: RaceSourceSummary }> = (props) => {
	if (!props.summary.present)
		return (
			<Typography color="text.secondary" variant="caption">
				—
			</Typography>
		);
	const shown = props.summary.candidates.slice(0, CANDIDATE_CAP);
	const extra = props.summary.candidates.length - shown.length;
	return (
		<Box sx={{ minWidth: 170 }}>
			<Typography color="text.secondary" sx={{ display: 'block', mb: 0.5 }} variant="caption">
				{props.summary.pctIn ?? '—'}% in
			</Typography>
			{shown.length === 0 ? (
				<Typography color="text.secondary" variant="caption">
					no candidates
				</Typography>
			) : (
				shown.map((candidate) => (
					<Box
						key={candidate.name}
						sx={{
							alignItems: 'baseline',
							display: 'flex',
							gap: 1,
							justifyContent: 'space-between',
						}}
					>
						<Typography
							noWrap={true}
							sx={{ fontSize: 12, fontWeight: candidate.called ? 700 : 400 }}
						>
							{candidate.called ? '✓ ' : ''}
							{candidate.name}
						</Typography>
						<Typography
							color="text.secondary"
							sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
						>
							{candidate.votes.toLocaleString()} · {candidate.pct}%
						</Typography>
					</Box>
				))
			)}
			{extra > 0 && (
				<Typography color="text.secondary" sx={{ display: 'block', mt: 0.5 }} variant="caption">
					+{extra} more
				</Typography>
			)}
		</Box>
	);
};

// Full-width races overview: a row per race, a column per source, the three streams
// side by side so a divergence (votes, leader, a ✓ in one column only) shows at a
// glance. Clicking a row opens the per-candidate detail modal.
const RaceTable: React.FC<Props> = (props) => {
	if (props.races.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				No races yet. Add DDHQ queries, enable Chameleon, or capture a frame.
			</Typography>
		);
	return (
		<Table size="small" sx={{ '& td, & th': { verticalAlign: 'top' } }}>
			<TableHead>
				<TableRow>
					<TableCell>Race</TableCell>
					{SOURCES.map((source) => (
						<TableCell key={source}>{sourceLabel(source)}</TableCell>
					))}
				</TableRow>
			</TableHead>
			<TableBody>
				{props.races.map((race) => (
					<TableRow
						hover={true}
						key={race.raceKey}
						onClick={() => props.onSelect(race.raceKey)}
						sx={{ cursor: 'pointer' }}
					>
						<TableCell sx={{ maxWidth: 320 }}>
							<Typography sx={{ fontSize: 13 }}>{race.raceKey}</Typography>
							<Box
								sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}
							>
								{race.alertCount > 0 && (
									<Chip
										color="error"
										label={`${race.alertCount} alert`}
										size="small"
										sx={{ fontSize: 10, height: 18 }}
									/>
								)}
								{race.provisional && (
									<Chip
										color="warning"
										label="provisional"
										size="small"
										sx={{ fontSize: 10, height: 18 }}
									/>
								)}
								{race.pendingLinkCount > 0 && (
									<Chip
										color="secondary"
										label={`${race.pendingLinkCount} link`}
										size="small"
										sx={{ fontSize: 10, height: 18 }}
									/>
								)}
								<Typography color="text.secondary" sx={{ ml: 'auto' }} variant="caption">
									{ago(race.lastAt)}
								</Typography>
							</Box>
						</TableCell>
						{SOURCES.map((source) => (
							<TableCell key={source}>
								<SourceCell summary={race.sources[source]} />
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
};

export default RaceTable;
