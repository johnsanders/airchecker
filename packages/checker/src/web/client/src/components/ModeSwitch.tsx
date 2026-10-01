import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { Mode } from '../api.js';

import { api } from '../api.js';
import { COLORS } from '../theme.js';

// On the amber Sim bar the default outline and selected tint vanish, so they go dark.
const ON_AMBER = {
	'& .MuiToggleButton-root': { borderColor: 'rgba(21, 26, 35, .45)', color: COLORS.console },
	'& .MuiToggleButton-root.Mui-disabled': {
		borderColor: 'rgba(21, 26, 35, .3)',
		color: 'rgba(21, 26, 35, .55)',
	},
	'& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover': {
		bgcolor: COLORS.console,
		color: COLORS.amber,
	},
} as const;

type Props = { mode: Mode | null; monitoring: boolean; onAmber: boolean };

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
		<Box sx={{ alignItems: 'center', display: 'flex', gap: 1, ml: { sm: 3, xs: 0 } }}>
			<ToggleButtonGroup
				disabled={props.monitoring}
				exclusive={true}
				onChange={(_event, next: Mode | null) => pick(next)}
				size="small"
				sx={props.onAmber ? ON_AMBER : {}}
				value={props.mode}
			>
				<ToggleButton value="live">Live</ToggleButton>
				<ToggleButton value="sim">Sim</ToggleButton>
			</ToggleButtonGroup>
			<Typography
				color={error !== '' ? 'error' : props.onAmber ? 'inherit' : 'text.secondary'}
				sx={{ opacity: error === '' && props.onAmber ? 0.75 : 1 }}
				variant="caption"
			>
				{error !== '' ? error : props.monitoring ? 'stop monitoring to switch' : ''}
			</Typography>
		</Box>
	);
};

export default ModeSwitch;
