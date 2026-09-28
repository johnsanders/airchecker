import { createTheme } from '@mui/material/styles';

// Dark control-room palette — borrows nn-toolbox's createTheme shape and its blue
// primary, tuned darker for an at-a-glance election-night monitor.
const theme = createTheme({
	components: {
		MuiTableCell: { styleOverrides: { root: { fontVariantNumeric: 'tabular-nums' } } },
	},
	palette: {
		background: { default: '#0b1020', paper: '#121a33' },
		divider: '#243056',
		error: { main: '#ff7676' },
		mode: 'dark',
		primary: { main: '#2d6cdf' },
		success: { main: '#4caf82' },
		warning: { main: '#ffce56' },
	},
	typography: {
		fontFamily: 'system-ui, -apple-system, Helvetica, sans-serif',
		fontSize: 13,
	},
});

export default theme;
