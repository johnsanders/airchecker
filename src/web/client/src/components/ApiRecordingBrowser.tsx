import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { ApiRecordingDetail, ApiResponseSummary, ApiSource } from '../api.js';

import { api, apiResponseBodyUrl } from '../api.js';

interface Props {
	inProgress: boolean;
	name: string | undefined;
	onClose: () => void;
}

interface RowProps {
	name: string;
	row: ApiResponseSummary;
}

type SourceFilter = 'all' | ApiSource;

const PAGE_SIZE = 200;
// Rows land on the pollers' 60 s check without a change nudge, so refresh while recording.
const RECORDING_REFRESH_MS = 10_000;
// Pretty-printing much more than this stalls the tab; the raw link still opens it.
const PRETTY_MAX_BYTES = 2 * 1024 ** 2;

const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// Read-only view of one API recording: what was captured, newest first, and any one
// response's stored JSON. The body only mounts while open, so each open starts fresh.
const ApiRecordingBrowser: React.FC<Props> = (props) => (
	<Dialog fullWidth={true} maxWidth="xl" onClose={props.onClose} open={props.name !== undefined}>
		{props.name !== undefined && (
			<>
				<DialogTitle sx={{ pr: 6, wordBreak: 'break-all' }}>
					{props.name}
					<IconButton
						aria-label="close"
						onClick={props.onClose}
						sx={{ color: 'text.secondary', position: 'absolute', right: 8, top: 8 }}
					>
						<CloseIcon />
					</IconButton>
				</DialogTitle>
				<DialogContent dividers={true}>
					<RecordingBrowser inProgress={props.inProgress} name={props.name} />
				</DialogContent>
			</>
		)}
	</Dialog>
);

const RecordingBrowser: React.FC<{ inProgress: boolean; name: string }> = (props) => {
	const [meta, setMeta] = React.useState<ApiRecordingDetail | undefined>(undefined);
	const [source, setSource] = React.useState<SourceFilter>('all');
	const [errorsOnly, setErrorsOnly] = React.useState(false);
	const [rows, setRows] = React.useState<ApiResponseSummary[] | undefined>(undefined);
	const [hasOlder, setHasOlder] = React.useState(false);
	const [loadingOlder, setLoadingOlder] = React.useState(false);
	const [selected, setSelected] = React.useState<ApiResponseSummary | undefined>(undefined);
	const [msg, setMsg] = React.useState('');

	React.useEffect(() => {
		let active = true;
		const load = async (): Promise<void> => {
			try {
				const next = await api.getApiRecordingMeta(props.name);
				if (active) setMeta(next);
			} catch (error) {
				if (active) setMsg(errorMessage(error));
			}
		};
		void load();
		const timer = props.inProgress
			? setInterval(() => void load(), RECORDING_REFRESH_MS)
			: undefined;
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [props.name, props.inProgress]);

	// The first page on open and on every filter change; while recording, newer rows are
	// merged on top so pages already loaded below stay put.
	React.useEffect(() => {
		let active = true;
		const query = { errorsOnly, limit: PAGE_SIZE, source: source === 'all' ? undefined : source };
		const loadNewest = async (merge: boolean): Promise<void> => {
			try {
				const page = (await api.listApiResponses(props.name, query)).responses;
				if (!active) return;
				setMsg('');
				if (merge)
					setRows((current) => [
						...page.filter((row) => row.seq > (current?.[0]?.seq ?? 0)),
						...(current ?? []),
					]);
				else {
					setRows(page);
					setHasOlder(page.length === PAGE_SIZE);
				}
			} catch (error) {
				if (active) setMsg(errorMessage(error));
			}
		};
		void loadNewest(false);
		const timer = props.inProgress
			? setInterval(() => void loadNewest(true), RECORDING_REFRESH_MS)
			: undefined;
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [props.name, props.inProgress, source, errorsOnly]);

	// Filters are disabled meanwhile, so the page always belongs to the rows shown.
	const loadOlder = async (before: number): Promise<void> => {
		setLoadingOlder(true);
		try {
			const page = (
				await api.listApiResponses(props.name, {
					before,
					errorsOnly,
					limit: PAGE_SIZE,
					source: source === 'all' ? undefined : source,
				})
			).responses;
			setRows((current) => [...(current ?? []), ...page]);
			setHasOlder(page.length === PAGE_SIZE);
		} catch (error) {
			setMsg(errorMessage(error));
		} finally {
			setLoadingOlder(false);
		}
	};

	const oldest = rows?.[rows.length - 1];

	return (
		<Box>
			{meta !== undefined && <RecordingHeader inProgress={props.inProgress} meta={meta} />}
			<Stack alignItems="center" direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 1 }}>
				<ToggleButtonGroup
					disabled={loadingOlder}
					exclusive={true}
					onChange={(_event, next: null | SourceFilter) => setSource(next ?? source)}
					size="small"
					value={source}
				>
					<ToggleButton value="all">All</ToggleButton>
					<ToggleButton value="DDHQ">DDHQ</ToggleButton>
					<ToggleButton value="Ross">Ross</ToggleButton>
				</ToggleButtonGroup>
				<FormControlLabel
					control={
						<Checkbox
							checked={errorsOnly}
							disabled={loadingOlder}
							onChange={(event) => setErrorsOnly(event.target.checked)}
							size="small"
						/>
					}
					label="errors only"
				/>
				<Typography color="error" variant="caption">
					{msg}
				</Typography>
			</Stack>
			<Grid container={true} spacing={2}>
				<Grid size={{ md: 7, xs: 12 }}>
					<TableContainer sx={{ maxHeight: '65vh' }}>
						<Table size="small" stickyHeader={true}>
							<TableHead>
								<TableRow>
									<TableCell align="right">#</TableCell>
									<TableCell>Time</TableCell>
									<TableCell>Source</TableCell>
									<TableCell>Path</TableCell>
									<TableCell align="right">KB</TableCell>
									<TableCell>Error</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{rows?.length === 0 && (
									<TableRow>
										<TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
											No responses.
										</TableCell>
									</TableRow>
								)}
								{rows?.map((row) => (
									<TableRow
										hover={true}
										key={row.seq}
										onClick={() => setSelected(row)}
										selected={row.seq === selected?.seq}
										sx={{ cursor: 'pointer' }}
									>
										<TableCell align="right">{row.seq}</TableCell>
										<TableCell sx={{ whiteSpace: 'nowrap' }}>
											{new Date(row.ts).toLocaleTimeString()}
										</TableCell>
										<TableCell>{row.source}</TableCell>
										<TableCell
											sx={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'break-word' }}
										>
											{row.path}
										</TableCell>
										<TableCell align="right">{row.error === null ? kb(row.bytes) : '—'}</TableCell>
										<TableCell
											sx={{
												color: 'error.main',
												maxWidth: 180,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{row.error !== null && (
												<Tooltip title={row.error}>
													<span>{row.error}</span>
												</Tooltip>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableContainer>
					{rows === undefined && (
						<Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
							loading…
						</Typography>
					)}
					{hasOlder && oldest !== undefined && (
						<Button
							disabled={loadingOlder}
							onClick={() => void loadOlder(oldest.seq)}
							size="small"
							sx={{ mt: 1 }}
						>
							{loadingOlder ? 'loading…' : 'Load older'}
						</Button>
					)}
				</Grid>
				<Grid size={{ md: 5, xs: 12 }}>
					{selected === undefined ? (
						<Typography color="text.secondary" variant="body2">
							Click a response to see what was stored.
						</Typography>
					) : (
						<ResponseDetail name={props.name} row={selected} />
					)}
				</Grid>
			</Grid>
		</Box>
	);
};

const RecordingHeader: React.FC<{ inProgress: boolean; meta: ApiRecordingDetail }> = (props) => (
	<Box sx={{ mb: 1.5 }}>
		<Typography variant="body2">
			Started {new Date(props.meta.startedAt).toLocaleString()} ·{' '}
			{props.meta.stoppedAt !== null
				? `stopped ${new Date(props.meta.stoppedAt).toLocaleString()}`
				: props.inProgress
					? 'still recording'
					: 'never stopped'}
		</Typography>
		<Stack direction="row" spacing={2}>
			{props.meta.sources.length === 0 && (
				<Typography color="text.secondary" variant="body2">
					No responses yet.
				</Typography>
			)}
			{props.meta.sources.map((counts) => (
				<Typography key={counts.source} variant="body2">
					<b>{counts.source}</b> {plural(counts.responses, 'response')}
					{counts.errors > 0 && (
						<Box component="span" sx={{ color: 'error.main' }}>
							{' '}
							· {plural(counts.errors, 'error')}
						</Box>
					)}
				</Typography>
			))}
		</Stack>
		<Typography color="text.secondary" variant="caption">
			DDHQ queries:{' '}
			{props.meta.ddhqQueries.length === 0 ? (
				'none'
			) : (
				<Box component="code">{props.meta.ddhqQueries.join(' · ')}</Box>
			)}
		</Typography>
	</Box>
);

const ResponseDetail: React.FC<RowProps> = (props) => (
	<Box>
		<Stack alignItems="baseline" direction="row" spacing={1}>
			<Typography variant="body2">
				<b>#{props.row.seq}</b> · {props.row.source} · {new Date(props.row.ts).toLocaleString()}
			</Typography>
			{props.row.error === null && (
				<Link
					href={apiResponseBodyUrl(props.name, props.row.seq)}
					rel="noreferrer"
					target="_blank"
					variant="body2"
				>
					open raw
				</Link>
			)}
		</Stack>
		<Typography sx={{ fontFamily: 'monospace', fontSize: 12, mb: 1, overflowWrap: 'anywhere' }}>
			{props.row.path}
		</Typography>
		{props.row.error !== null ? (
			<Typography
				color="error"
				sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}
			>
				{props.row.error}
			</Typography>
		) : props.row.bytes > PRETTY_MAX_BYTES ? (
			<Typography color="text.secondary" variant="body2">
				{kb(props.row.bytes)} KB is too large to show here; open it raw.
			</Typography>
		) : (
			<PrettyBody key={props.row.seq} name={props.name} row={props.row} />
		)}
	</Box>
);

// Keyed by seq: each selection mounts fresh, so a slow fetch can't land on another row.
const PrettyBody: React.FC<RowProps> = (props) => {
	const [text, setText] = React.useState<{ failed: boolean; value: string } | undefined>(undefined);

	React.useEffect(() => {
		let active = true;
		const load = async (): Promise<void> => {
			try {
				const raw = await api.getApiResponseBody(props.name, props.row.seq);
				if (active) setText({ failed: false, value: JSON.stringify(JSON.parse(raw), null, 2) });
			} catch (error) {
				if (active) setText({ failed: true, value: errorMessage(error) });
			}
		};
		void load();
		return () => {
			active = false;
		};
	}, [props.name, props.row.seq]);

	if (text === undefined)
		return (
			<Typography color="text.secondary" variant="body2">
				loading…
			</Typography>
		);
	if (text.failed)
		return (
			<Typography color="error" variant="body2">
				{text.value}
			</Typography>
		);
	return (
		<Box
			component="pre"
			sx={{
				bgcolor: 'action.hover',
				borderRadius: 1,
				fontFamily: 'monospace',
				fontSize: 12,
				m: 0,
				maxHeight: '60vh',
				overflow: 'auto',
				p: 1,
			}}
		>
			{text.value}
		</Box>
	);
};

export default ApiRecordingBrowser;
