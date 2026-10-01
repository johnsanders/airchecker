import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { ApiRecordingSummary, Status } from '../api.js';

import { api } from '../api.js';
import ApiRecordingBrowser from './ApiRecordingBrowser.js';

interface Props {
	onChange: () => Promise<void>;
	status: Status | undefined;
}

// Response counts move on the recorder's checks; refresh the list meanwhile.
const RECORDING_REFRESH_MS = 10_000;

// A <button> styled as a link doesn't inherit the surrounding text's font on its own.
const INLINE_BUTTON = { font: 'inherit', verticalAlign: 'baseline' } as const;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const megabytes = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const clockTime = (ts: number): string =>
	new Date(ts).toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
	});

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

// Records the raw DDHQ + Chameleon responses (every sample interval), and plays a recording back
// on the mirror endpoints at 1×. Recording and playback are independent. Any recording,
// the one in progress included, opens read-only in ApiRecordingBrowser. Delete asks twice
// and isn't offered for the recording in progress or the one playing back.
const RecordPanel: React.FC<Props> = (props) => {
	const [name, setName] = React.useState('');
	const [msg, setMsg] = React.useState('');
	const [recordings, setRecordings] = React.useState<ApiRecordingSummary[]>([]);
	const [now, setNow] = React.useState(() => Date.now());
	const [browsing, setBrowsing] = React.useState<string | undefined>(undefined);
	const [confirmingDelete, setConfirmingDelete] = React.useState<string | undefined>(undefined);
	// Where the slider is while it's dragged; the playback only moves when it's let go.
	const [draggingMs, setDraggingMs] = React.useState<null | number>(null);
	const checkerWatching = props.status?.checkerWatching ?? false;
	const recording = props.status?.recording ?? null;
	const playback = props.status?.playback ?? null;
	const onChange = props.onChange;

	const loadList = React.useCallback(async (): Promise<void> => {
		const response = await api.listApiRecordings();
		setRecordings(response.recordings);
	}, []);
	React.useEffect(() => {
		void loadList();
	}, [loadList]);

	React.useEffect(() => {
		if (recording === null) return undefined;
		const timer = setInterval(() => {
			setNow(Date.now());
			void loadList();
		}, RECORDING_REFRESH_MS);
		return () => clearInterval(timer);
	}, [recording, loadList]);

	const act = async (action: () => Promise<unknown>): Promise<void> => {
		try {
			await action();
			setMsg('');
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'failed');
		}
		await onChange();
		await loadList();
	};

	const start = () =>
		act(async () => {
			await api.startApiRecording(name.trim().length > 0 ? name.trim() : undefined);
			setName('');
			setNow(Date.now());
		});

	const remove = async (target: string): Promise<void> => {
		setConfirmingDelete(undefined);
		try {
			const response = await api.deleteApiRecording(target);
			setMsg(`deleted ${target} (${megabytes(response.freedBytes)} freed)`);
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'could not delete');
		}
		await loadList();
	};

	return (
		<Box>
			{playback !== null && (
				<Box sx={{ borderLeft: 3, borderLeftColor: 'success.main', mb: 2.5, pl: 1.5 }}>
					<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 0.5 }}>
						<Button
							onClick={() =>
								void act(() => api.playbackAction(playback.paused ? 'resume' : 'pause'))
							}
							size="small"
							variant="contained"
						>
							{playback.paused ? '▶ Resume' : '❚❚ Pause'}
						</Button>
						<Button
							onClick={() => void act(() => api.playbackAction('restart'))}
							size="small"
							variant="outlined"
						>
							↺ Restart
						</Button>
						<Button
							color="error"
							onClick={() => void act(() => api.playbackAction('stop'))}
							size="small"
							variant="outlined"
						>
							■ Stop playback
						</Button>
						<Typography variant="body2">
							Playing back <b>{playback.name}</b> · {minutes(playback.elapsedMs)} of{' '}
							{minutes(playback.durationMs)}
							{playback.paused ? ' · paused' : ''}
							{playback.ended ? ' · ended (last responses held)' : ''}
						</Typography>
					</Stack>
					<Box sx={{ px: 1 }}>
						<Slider
							disabled={checkerWatching}
							marks={[
								{ label: clockTime(playback.startTs), value: 0 },
								{
									label: clockTime(playback.startTs + playback.durationMs),
									value: playback.durationMs,
								},
							]}
							max={playback.durationMs}
							min={0}
							onChange={(_event, value) => setDraggingMs(value as number)}
							onChangeCommitted={(_event, value) =>
								void act(() => api.seekApiPlayback(value as number)).then(() => setDraggingMs(null))
							}
							size="small"
							step={1000}
							value={draggingMs ?? Math.min(playback.elapsedMs, playback.durationMs)}
							valueLabelDisplay="auto"
							valueLabelFormat={(value) => clockTime(playback.startTs + value)}
						/>
					</Box>
					{checkerWatching && (
						<Typography color="warning.main" sx={{ display: 'block' }} variant="caption">
							The checker is monitoring this playback. Stop monitoring in the checker to scrub.
						</Typography>
					)}
					<Typography color="text.secondary" sx={{ display: 'block' }} variant="caption">
						The mirror answers from this recording, and the simulated air shows its take-list races
						(starting a simulated night stops it). The checker's Sim mode polls these DDHQ queries:
					</Typography>
					<Box
						component="pre"
						sx={{ fontFamily: MONO, fontSize: 12, m: 0, mt: 0.5, userSelect: 'all' }}
					>
						{playback.ddhqQueries.length === 0 ? '(none)' : playback.ddhqQueries.join('\n')}
					</Box>
				</Box>
			)}
			<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
				{recording === null ? (
					<>
						<TextField
							label="name (optional)"
							onChange={(event) => setName(event.target.value)}
							size="small"
							sx={{ width: 220 }}
							value={name}
						/>
						<Button color="error" onClick={() => void start()} variant="contained">
							● Record
						</Button>
					</>
				) : (
					<>
						<Button color="error" onClick={() => void act(api.stopApiRecording)} variant="outlined">
							■ Stop
						</Button>
						<Typography variant="body2">
							Recording <b>{recording.name}</b> · {minutes(Math.max(0, now - recording.startedAt))}{' '}
							· {recording.responseCount} responses ·{' '}
							<Link
								component="button"
								onClick={() => setBrowsing(recording.name)}
								sx={INLINE_BUTTON}
							>
								Browse
							</Link>
						</Typography>
					</>
				)}
				<Typography color="text.secondary" variant="caption">
					{msg}
				</Typography>
			</Stack>
			<Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="body2">
				Records DDHQ's integration host and Chameleon, checking both every{' '}
				{props.status?.recordIntervalSeconds ?? '…'} s. Production DDHQ is never recorded.
			</Typography>
			{props.status?.recordErrors.map((error) => (
				<Typography color="error" key={error} sx={{ display: 'block' }} variant="caption">
					{error}
				</Typography>
			))}
			<Box sx={{ borderTop: 1, borderTopColor: 'divider', mt: 1.5 }}>
				{recordings.map((summary) => (
					<Box
						key={summary.file}
						sx={{
							'&:hover': { bgcolor: 'action.hover' },
							alignItems: 'center',
							borderBottom: 1,
							borderColor: 'divider',
							columnGap: 1.5,
							display: 'flex',
							flexWrap: 'wrap',
							fontSize: 13,
							mx: -1,
							px: 1,
							py: 0.75,
						}}
					>
						<Button
							disabled={recording?.name === summary.name}
							onClick={() => void act(() => api.startApiPlayback(summary.name))}
							size="small"
							sx={{ minWidth: 0, px: 1.25, py: 0 }}
							variant="outlined"
						>
							▶ Play
						</Button>
						<Link
							component="button"
							onClick={() => setBrowsing(summary.name)}
							sx={{ ...INLINE_BUTTON, fontWeight: 700 }}
						>
							{summary.name}
						</Link>
						<Box component="span" sx={{ color: 'text.secondary' }}>
							{new Date(summary.startedAt).toLocaleString()} · {summary.responseCount} responses
						</Box>
						{summary.stoppedAt === null && (
							<Box component="span" sx={{ color: 'error.main', fontWeight: 600 }}>
								in progress
							</Box>
						)}
						{playback?.name === summary.name && (
							<Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
								playing
							</Box>
						)}
						<Box sx={{ display: 'flex', gap: 1.5, ml: 'auto' }}>
							{recording?.name === summary.name ||
							playback?.name === summary.name ? null : confirmingDelete === summary.name ? (
								<>
									<Link
										color="error"
										component="button"
										onClick={() => void remove(summary.name)}
										sx={{ ...INLINE_BUTTON, fontWeight: 700 }}
									>
										Delete recording
									</Link>
									<Link
										component="button"
										onClick={() => setConfirmingDelete(undefined)}
										sx={INLINE_BUTTON}
									>
										Cancel
									</Link>
								</>
							) : (
								<Link
									color="error"
									component="button"
									onClick={() => setConfirmingDelete(summary.name)}
									sx={INLINE_BUTTON}
								>
									Delete
								</Link>
							)}
						</Box>
					</Box>
				))}
			</Box>
			<ApiRecordingBrowser
				inProgress={recording !== null && recording.name === browsing}
				name={browsing}
				onClose={() => setBrowsing(undefined)}
			/>
		</Box>
	);
};

export default RecordPanel;
