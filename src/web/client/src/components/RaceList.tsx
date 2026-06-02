import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceSummary, SourceName } from '../api.js';

import { sourceLabel } from '../api.js';
import { ago } from '../format.js';

interface Props {
	onSelect: (raceKey: string) => void;
	races: RaceSummary[];
	selected: string | undefined;
}

const SOURCES: SourceName[] = ['DDHQ', 'Ross', 'air'];

// The race list: each row shows which sources have data (colored chips) and an
// alert badge. Clicking selects it for the detail comparison.
const RaceList: React.FC<Props> = (props) => {
	if (props.races.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				No races yet. Add DDHQ queries, enable Chameleon, or capture a frame.
			</Typography>
		);
	return (
		<List dense disablePadding>
			{props.races.map((race) => (
				<ListItemButton
					key={race.raceKey}
					onClick={() => props.onSelect(race.raceKey)}
					selected={race.raceKey === props.selected}
					sx={{ borderRadius: 1, mb: 0.5 }}
				>
					<Box sx={{ flex: 1, minWidth: 0 }}>
						<Typography noWrap sx={{ fontSize: 13 }}>
							{race.raceKey}
						</Typography>
						<Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5, mt: 0.5 }}>
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
							{SOURCES.map((s) => (
								<Chip
									color={race.present[s] ? 'primary' : 'default'}
									key={s}
									label={sourceLabel(s)}
									size="small"
									sx={{ fontSize: 10, height: 18, opacity: race.present[s] ? 1 : 0.4 }}
									variant={race.present[s] ? 'filled' : 'outlined'}
								/>
							))}
							<Typography color="text.secondary" sx={{ ml: 'auto' }} variant="caption">
								{ago(race.lastAt)}
							</Typography>
						</Box>
					</Box>
					{race.alertCount > 0 && (
						<Badge badgeContent={race.alertCount} color="error" sx={{ ml: 2, mr: 1 }} />
					)}
				</ListItemButton>
			))}
		</List>
	);
};

export default RaceList;
