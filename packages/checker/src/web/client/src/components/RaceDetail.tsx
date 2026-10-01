import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { RaceDetailResponse } from '../api.js';

import { api } from '../api.js';
import { useLiveQuery } from '../useLiveQuery.js';
import AirReadTable from './AirReadTable.js';
import ObservationTable from './ObservationTable.js';

interface Props {
	raceKey: string;
}

const Heading: React.FC<{ children: React.ReactNode }> = (props) => (
	<Typography component="h3" sx={{ fontSize: 14, fontWeight: 700, mb: 1, mt: 2.5 }}>
		{props.children}
	</Typography>
);

// One race: every read of it off air as a record beside what Ross and DDHQ said at the
// time, then everything each of the three sources has said about it.
const RaceDetail: React.FC<Props> = (props) => {
	const { data, error } = useLiveQuery<RaceDetailResponse>(
		() => api.getRace(props.raceKey),
		[props.raceKey],
	);

	if (error !== undefined)
		return <Typography color="error">Failed to load race: {error}</Typography>;
	if (data === undefined) return <Typography color="text.secondary">Loading…</Typography>;

	return (
		<Box>
			<Heading>Air reads ({data.reads.length}, last 30 min, newest first)</Heading>
			<AirReadTable reads={data.reads} />
			<Heading>
				Every observation ({data.observations.length}, newest first). DDHQ and Ross are listed when
				what they say changes.
			</Heading>
			<ObservationTable observations={data.observations} />
		</Box>
	);
};

export default RaceDetail;
