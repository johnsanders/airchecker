import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceLinksResponse } from '../api.js';

import { api } from '../api.js';
import { useLiveQuery } from '../useLiveQuery.js';

interface Props {
	monitoring: boolean;
	onSelectRace: (raceKey: string) => void;
}

const NOT_LINKED = '';

const HOW: Record<string, string> = {
	deterministic: 'by heading',
	manual: 'set by you',
	proposal: 'model, accepted',
	provisional: '—',
};

const time = (ts: number): string => new Date(ts).toLocaleTimeString('en-US', { hour12: false });

// Only races seen on air matter: each air heading, the DDHQ race it's linked to, and whether
// Ross has that race too (Ross links to DDHQ by race ID on its own).
const RaceLinks: React.FC<Props> = (props) => {
	const { data, reload } = useLiveQuery<RaceLinksResponse>(() => api.getRaceLinks());
	const [confirming, setConfirming] = React.useState(false);
	const [error, setError] = React.useState('');
	const links = data ?? { aliases: [], canonicalRaces: [], proposals: [] };

	const ddhqRaces = links.canonicalRaces
		.filter((race) => !race.provisional)
		.map((race) => race.canonicalRaceKey)
		.sort();
	const rossLinked = new Set(
		links.aliases
			.filter((alias) => alias.source === 'Ross' && alias.method !== 'provisional')
			.map((alias) => alias.canonicalRaceKey),
	);
	const airRaces = links.aliases
		.filter((alias) => alias.source === 'air')
		.sort((a, b) => b.updatedAt - a.updatedAt);
	const pending = links.proposals.filter(
		(proposal) => proposal.source === 'air' && proposal.status === 'pending',
	);

	const relink = async (sourceRaceKey: string, canonicalRaceKey: string): Promise<void> => {
		await api.setRaceAlias({ canonicalRaceKey, source: 'air', sourceRaceKey });
		await reload();
	};

	const clear = async (): Promise<void> => {
		if (!confirming) return setConfirming(true);
		setConfirming(false);
		await api
			.resetRaceLinks()
			.then(() => setError(''))
			.catch((caught: unknown) =>
				setError(caught instanceof Error ? caught.message : 'clear failed'),
			);
		await reload();
	};

	return (
		<Stack spacing={2}>
			<Box sx={{ alignItems: 'center', display: 'flex', gap: 2 }}>
				<Typography color="text.secondary" sx={{ flex: 1 }} variant="body2">
					Each race read off air and the DDHQ race it's linked to. Click a race to see every
					observation of it.
				</Typography>
				<Typography color={error === '' ? 'text.secondary' : 'error'} variant="caption">
					{error !== '' ? error : props.monitoring ? 'stop monitoring to clear' : ''}
				</Typography>
				<Button
					color={confirming ? 'error' : 'inherit'}
					disabled={props.monitoring}
					onBlur={() => setConfirming(false)}
					onClick={() => void clear()}
					size="small"
					variant="outlined"
				>
					{confirming ? 'Click again to clear' : 'Clear all links'}
				</Button>
			</Box>

			{pending.map((proposal) => (
				<Box
					key={proposal.id}
					sx={{ border: '1px solid', borderColor: 'warning.main', borderRadius: 1, p: 1 }}
				>
					<Typography sx={{ fontSize: 13 }}>
						Air showed <b>{proposal.sourceRaceKey}</b> (
						{proposal.incoming.candidateNames.join(', ')}
						). The model thinks it's <b>{proposal.candidateCanonicalRaceKey ?? 'none'}</b>.
					</Typography>
					<Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
						{proposal.reason}
					</Typography>
					<Stack direction="row" spacing={1} sx={{ mt: 1 }}>
						<Button
							onClick={async () => {
								await api.acceptRaceProposal(proposal.id);
								await reload();
							}}
							size="small"
							variant="contained"
						>
							Accept
						</Button>
						<Button
							onClick={async () => {
								await api.rejectRaceProposal(proposal.id);
								await reload();
							}}
							size="small"
						>
							Reject
						</Button>
					</Stack>
				</Box>
			))}

			{airRaces.length === 0 ? (
				<Typography color="text.secondary" variant="body2">
					Nothing seen on air yet.
				</Typography>
			) : (
				<Table size="small">
					<TableHead>
						<TableRow>
							<TableCell>Last seen</TableCell>
							<TableCell>On air</TableCell>
							<TableCell>DDHQ race</TableCell>
							<TableCell>How</TableCell>
							<TableCell>Ross</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{airRaces.map((alias) => {
							const linked = alias.method !== 'provisional';
							return (
								<TableRow
									hover={true}
									key={alias.sourceRaceKey}
									onClick={() => props.onSelectRace(alias.canonicalRaceKey)}
									sx={{ cursor: 'pointer' }}
								>
									<TableCell sx={{ whiteSpace: 'nowrap' }}>{time(alias.updatedAt)}</TableCell>
									<TableCell sx={{ fontWeight: 600 }}>{alias.sourceRaceKey}</TableCell>
									<TableCell onClick={(event) => event.stopPropagation()}>
										<Select
											displayEmpty={true}
											onChange={(event) => void relink(alias.sourceRaceKey, event.target.value)}
											size="small"
											sx={{ fontSize: 12, minWidth: 320 }}
											value={linked ? alias.canonicalRaceKey : NOT_LINKED}
										>
											<MenuItem disabled={true} value={NOT_LINKED}>
												<Typography color="error" sx={{ fontSize: 12 }}>
													not linked
												</Typography>
											</MenuItem>
											{ddhqRaces.map((raceKey) => (
												<MenuItem key={raceKey} sx={{ fontSize: 12 }} value={raceKey}>
													{raceKey}
												</MenuItem>
											))}
										</Select>
									</TableCell>
									<TableCell>{HOW[alias.method] ?? alias.method}</TableCell>
									<TableCell>
										{linked && rossLinked.has(alias.canonicalRaceKey) ? '✓' : '—'}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</Stack>
	);
};

export default RaceLinks;
