import { createTheme } from '@mui/material/styles';

// Dark control-room palette — borrows nn-toolbox's createTheme shape and its blue
// primary, tuned darker for an at-a-glance election-night monitor.
const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0b1020', paper: '#121a33' },
    primary: { main: '#2d6cdf' },
    error: { main: '#ff7676' },
    warning: { main: '#ffce56' },
    success: { main: '#4caf82' },
    divider: '#243056',
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, Helvetica, sans-serif',
    fontSize: 13,
  },
  components: {
    MuiTableCell: { styleOverrides: { root: { fontVariantNumeric: 'tabular-nums' } } },
  },
});

export default theme;
