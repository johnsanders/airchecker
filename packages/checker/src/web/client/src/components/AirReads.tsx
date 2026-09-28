import Typography from '@mui/material/Typography';
import React from 'react';

import { api } from '../api.js';
import { useLiveQuery } from '../useLiveQuery.js';
import ObservationTable from './ObservationTable.js';

interface Props {
	onSelectRace: (raceKey: string) => void;
}

// Everything read off air in the last 30 minutes, newest first, one row per graphic read.
// A row opens that race, with every observation of it from all three sources.
const AirReads: React.FC<Props> = (props) => {
	const { data } = useLiveQuery(() => api.getAirReads());
	const reads = data?.reads ?? [];
	if (reads.length === 0)
		return (
			<Typography color="text.secondary" variant="body2">
				Nothing read off air yet.
			</Typography>
		);
	return (
		<ObservationTable
			observations={reads}
			onSelect={(read) => props.onSelectRace(read.raceKey)}
			show="race"
		/>
	);
};

export default AirReads;
