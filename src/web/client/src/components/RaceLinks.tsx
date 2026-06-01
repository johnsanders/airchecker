import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceAlias, RaceLinksResponse, SourceName } from '../api.js';

import { api, sourceLabel } from '../api.js';
import { usePolling } from '../usePolling.js';

const aliasId = (alias: RaceAlias): string => `${alias.source}:${alias.sourceRaceKey}`;

const RaceLinks: React.FC = () => {
	const { data, reload } = usePolling<RaceLinksResponse>(() => api.getRaceLinks(), 3000);
	const links = data ?? { aliases: [], canonicalRaces: [], proposals: [] };
	const pending = links.proposals.filter((proposal) => proposal.status === 'pending');
	const nonProviderAliases = links.aliases.filter((alias) => alias.source !== 'DDHQ');

	const relink = async (
		source: SourceName,
		sourceRaceKey: string,
		canonicalRaceKey: string,
	): Promise<void> => {
		await api.setRaceAlias({ canonicalRaceKey, source, sourceRaceKey });
		await reload();
	};

	return (
		<Stack spacing={2}>
			<Box>
				<Typography color="text.secondary" variant="caption">
					Pending proposals
				</Typography>
				<Stack spacing={1} sx={{ mt: 1 }}>
					{pending.map((proposal) => (
						<Box
							key={proposal.id}
							sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}
						>
							<Typography sx={{ fontSize: 13, fontWeight: 600 }}>
								{sourceLabel(proposal.source)} / {proposal.sourceRaceKey}
							</Typography>
							<Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
								Candidate: {proposal.candidateCanonicalRaceKey ?? 'none'} / {proposal.reason}
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
					{pending.length === 0 && (
						<Typography color="text.secondary" variant="body2">
							No pending link proposals.
						</Typography>
					)}
				</Stack>
			</Box>

			<Box>
				<Typography color="text.secondary" variant="caption">
					Active source links
				</Typography>
				<Stack spacing={1} sx={{ mt: 1 }}>
					{nonProviderAliases.map((alias) => (
						<Box key={aliasId(alias)} sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
							<Chip label={sourceLabel(alias.source)} size="small" sx={{ minWidth: 64 }} />
							<Typography noWrap sx={{ flex: 1, fontSize: 12 }}>
								{alias.sourceRaceKey}
							</Typography>
							<Chip label={alias.method} size="small" variant="outlined" />
							<Select
								onChange={(event) =>
									void relink(alias.source, alias.sourceRaceKey, event.target.value)
								}
								size="small"
								sx={{ fontSize: 12, minWidth: 260 }}
								value={alias.canonicalRaceKey}
							>
								{links.canonicalRaces.map((race) => (
									<MenuItem key={race.canonicalRaceKey} value={race.canonicalRaceKey}>
										{race.provisional ? '[provisional] ' : ''}
										{race.canonicalRaceKey}
									</MenuItem>
								))}
							</Select>
						</Box>
					))}
					{nonProviderAliases.length === 0 && (
						<Typography color="text.secondary" variant="body2">
							No non-DDHQ links yet.
						</Typography>
					)}
				</Stack>
			</Box>
		</Stack>
	);
};

export default RaceLinks;
