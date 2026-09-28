import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Anomaly } from '../api.js';

import { ago } from '../format.js';

interface Props {
	alerts: Anomaly[];
	onSelectRace: (raceKey: string) => void;
}

const SEV_ORDER: Record<string, number> = { high: 0, low: 2, medium: 1 };
const SEV_COLOR: Record<string, 'default' | 'error' | 'warning'> = {
	high: 'error',
	low: 'default',
	medium: 'warning',
};

// Alerts grouped by race, severity-sorted (high first), each group expandable. The
// header chip shows the worst severity in the group + count; clicking a row jumps
// to that race's detail.
const Alerts: React.FC<Props> = (props) => {
	if (props.alerts.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				No alerts. (Cross-source alerts appear once two sources overlap on a race.)
			</Typography>
		);

	const byRace = new Map<string, Anomaly[]>();
	props.alerts.forEach((a) => {
		const list = byRace.get(a.raceKey) ?? [];
		list.push(a);
		byRace.set(a.raceKey, list);
	});
	const groups = Array.from(byRace.entries()).sort((a, b) => {
		const worst = (xs: Anomaly[]) => Math.min(...xs.map((x) => SEV_ORDER[x.severity] ?? 3));
		return worst(a[1]) - worst(b[1]);
	});

	return (
		<Box>
			{groups.map(([raceKey, alerts]) => {
				const worst = alerts.reduce(
					(acc, a) => ((SEV_ORDER[a.severity] ?? 3) < (SEV_ORDER[acc] ?? 3) ? a.severity : acc),
					'low',
				);
				return (
					<Accordion disableGutters key={raceKey} sx={{ bgcolor: 'background.paper' }}>
						<AccordionSummary expandIcon={<ExpandMoreIcon />}>
							<Chip
								color={SEV_COLOR[worst] ?? 'default'}
								label={alerts.length}
								size="small"
								sx={{ mr: 1.5 }}
							/>
							<Typography noWrap sx={{ flex: 1, fontSize: 13 }}>
								{raceKey}
							</Typography>
						</AccordionSummary>
						<AccordionDetails>
							{alerts.map((a) => (
								<Box
									key={`${a.type}|${a.subject ?? ''}|${a.detail}`}
									onClick={() => props.onSelectRace(raceKey)}
									sx={{ cursor: 'pointer', mb: 1 }}
								>
									<Typography
										sx={{ color: `${SEV_COLOR[a.severity] ?? 'text'}.light` }}
										variant="body2"
									>
										[{a.severity}] {a.type}
									</Typography>
									<Typography color="text.secondary" variant="caption">
										{a.detail} · {ago(a.observedAt)}
									</Typography>
								</Box>
							))}
						</AccordionDetails>
					</Accordion>
				);
			})}
		</Box>
	);
};

export default Alerts;
