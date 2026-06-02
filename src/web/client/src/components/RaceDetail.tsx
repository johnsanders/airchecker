import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceCell, RaceDetailResponse, RaceLinksResponse, SourceName } from '../api.js';

import { api } from '../api.js';
import { sourceLabel } from '../api.js';
import { useLiveQuery } from '../useLiveQuery.js';

interface Props {
	raceKey: string;
}

const SOURCES: SourceName[] = ['DDHQ', 'Ross', 'air'];

const fmtCell = (cell: RaceCell | undefined): React.ReactNode => {
	if (cell === undefined)
		return (
			<Typography color="text.secondary" variant="caption">
				—
			</Typography>
		);
	return (
		<>
			{cell.votes.toLocaleString()} · {cell.pct}%{cell.called ? ' ✓' : ''}
		</>
	);
};

// The core view: DDHQ / Ross / air side by side for one race. Each candidate is one
// row, aligned across sources (server matches by normalized name). A discrepancy —
// different votes, or a ✓ in one column but not another — is visible at a glance.
const RaceDetail: React.FC<Props> = (props) => {
	const { data, error } = useLiveQuery<RaceDetailResponse>(() => api.getRace(props.raceKey), [
		props.raceKey,
	]);
	const { data: links, reload: reloadLinks } = useLiveQuery<RaceLinksResponse>(() =>
		api.getRaceLinks(),
	);

	if (error !== undefined)
		return <Typography color="error">Failed to load race: {error}</Typography>;
	if (data === undefined) return <Typography color="text.secondary">Loading…</Typography>;

	return (
		<Box>
			<Typography sx={{ fontWeight: 600, mb: 1 }}>{data.raceKey}</Typography>

			<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
				{data.sources.map((s) => (
					<Box
						key={s.source}
						sx={{ color: s.present ? 'text.primary' : 'text.secondary', fontSize: 12 }}
					>
						<Stack spacing={0.5}>
							<Box>
								<b>{sourceLabel(s.source)}</b>: {s.present ? `${s.pctIn ?? '—'}% in` : 'no data'}
							</Box>
							{s.sourceRaceKey !== null && (
								<Typography color="text.secondary" variant="caption">
									{s.sourceRaceKey} / {s.aliasMethod ?? 'unlinked'}
								</Typography>
							)}
							{s.source !== 'DDHQ' && s.sourceRaceKey !== null && links !== undefined && (
								<Select
									onChange={async (event) => {
										await api.setRaceAlias({
											canonicalRaceKey: event.target.value,
											source: s.source,
											sourceRaceKey: s.sourceRaceKey!,
										});
										await reloadLinks();
									}}
									size="small"
									sx={{ fontSize: 12, minWidth: 220 }}
									value={s.canonicalRaceKey ?? props.raceKey}
								>
									{links.canonicalRaces.map((race) => (
										<MenuItem key={race.canonicalRaceKey} value={race.canonicalRaceKey}>
											{race.provisional ? '[provisional] ' : ''}
											{race.canonicalRaceKey}
										</MenuItem>
									))}
								</Select>
							)}
						</Stack>
					</Box>
				))}
			</Box>

			<Table size="small">
				<TableHead>
					<TableRow>
						<TableCell>Candidate</TableCell>
						{SOURCES.map((s) => (
							<TableCell align="right" key={s}>
								{sourceLabel(s)}
							</TableCell>
						))}
					</TableRow>
				</TableHead>
				<TableBody>
					{data.candidates.map((row) => (
						<TableRow key={row.name}>
							<TableCell>{row.name}</TableCell>
							{SOURCES.map((s) => (
								<TableCell align="right" key={s}>
									{fmtCell(row.cells[s])}
								</TableCell>
							))}
						</TableRow>
					))}
					{data.candidates.length === 0 && (
						<TableRow>
							<TableCell colSpan={4}>
								<Typography color="text.secondary" variant="caption">
									No candidate data yet for this race.
								</Typography>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>

			{data.anomalies.length > 0 && (
				<Paper sx={{ borderColor: 'error.main', borderLeft: '3px solid', mt: 2, p: 1.5 }}>
					<Typography color="text.secondary" variant="caption">
						{data.anomalies.length} anomaly(ies)
					</Typography>
					{data.anomalies.map((a, i) => (
						<Typography key={i} sx={{ color: 'error.light' }} variant="body2">
							[{a.severity}] {a.type}: {a.detail}
						</Typography>
					))}
				</Paper>
			)}
		</Box>
	);
};

export default RaceDetail;
