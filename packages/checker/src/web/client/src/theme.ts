import { createTheme } from '@mui/material/styles';

// Control-room palette for a dim room and a long night: a blue slate ground, and color
// kept for meaning. Red, amber and green are tally lights (alert, caution or Sim, live);
// blue is only for controls.
export const COLORS = {
	amber: '#f2b33d',
	blue: '#5b9dff',
	console: '#151a23',
	green: '#3fcf8e',
	ink: '#e4e8ef',
	muted: '#8a94a6',
	panel: '#1c222d',
	red: '#ff5a52',
	rule: '#2a3240',
} as const;

// Archivo narrowed a touch: dense numeric tables stay readable, with tabular figures.
const FONT = '"Archivo", system-ui, -apple-system, Helvetica, sans-serif';

export const theme = createTheme({
	components: {
		MuiButton: { styleOverrides: { root: { fontWeight: 600, textTransform: 'none' } } },
		MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 600 } } },
		MuiCssBaseline: {
			styleOverrides: {
				body: { fontFeatureSettings: '"tnum"', fontStretch: '92%' },
			},
		},
		MuiDialog: { styleOverrides: { paper: { border: `1px solid ${COLORS.rule}` } } },
		MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
		MuiTab: {
			styleOverrides: {
				root: { fontSize: 14, fontWeight: 600, minHeight: 44, textTransform: 'none' },
			},
		},
		MuiTableCell: {
			styleOverrides: {
				head: { color: COLORS.muted, fontSize: 12, fontWeight: 600 },
				root: { borderColor: COLORS.rule, fontVariantNumeric: 'tabular-nums' },
			},
		},
		MuiToggleButton: {
			styleOverrides: { root: { fontWeight: 600, paddingInline: 12, textTransform: 'none' } },
		},
	},
	palette: {
		background: { default: COLORS.console, paper: COLORS.panel },
		divider: COLORS.rule,
		error: { main: COLORS.red },
		mode: 'dark',
		primary: { main: COLORS.blue },
		success: { main: COLORS.green },
		text: { primary: COLORS.ink, secondary: COLORS.muted },
		warning: { main: COLORS.amber },
	},
	shape: { borderRadius: 6 },
	typography: {
		fontFamily: FONT,
		fontSize: 13,
	},
});
