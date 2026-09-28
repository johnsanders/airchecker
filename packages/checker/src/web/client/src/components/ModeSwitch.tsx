import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Mode } from '../api.js';

import { api } from '../api.js';

type Props = { mode: Mode | null; monitoring: boolean };

// Live watches DDHQ, Chameleon and the DirecTV tab; Sim watches the simulator standing in
// for all three. Locked while monitoring, so a session never mixes the two.
const ModeSwitch: React.FC<Props> = (props) => {
	const [error, setError] = React.useState('');

	if (props.mode === null) return null;

	const pick = (next: Mode | null): void => {
		if (next === null || next === props.mode) return;
		api
			.setMode(next)
			.then(() => setError(''))
			.catch((caught: unknown) =>
				setError(caught instanceof Error ? caught.message : 'switch failed'),
			);
	};

	return (
		<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, ml: 3 }}>
			<ToggleButtonGroup
				disabled={props.monitoring}
				exclusive={true}
				onChange={(_event, next: Mode | null) => pick(next)}
				size="small"
				value={props.mode}
			>
				<ToggleButton value="live">Live</ToggleButton>
				<ToggleButton value="sim">Sim</ToggleButton>
			</ToggleButtonGroup>
			<Typography color={error === '' ? 'text.secondary' : 'error'} variant="caption">
				{error !== '' ? error : props.monitoring ? 'stop monitoring to switch' : ''}
			</Typography>
		</Box>
	);
};

export default ModeSwitch;
