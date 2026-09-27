import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { ApiRecordingStatus, ApiRecordingSummary } from '../api.js';

import { api } from '../api.js';
import ApiRecordingBrowser from './ApiRecordingBrowser.js';

interface Props {
	onChange: () => Promise<void>;
	status: ApiRecordingStatus | undefined;
}

// Response counts and the playback position move without a change nudge, so refresh
// while recording or playing back.
const RECORDING_REFRESH_MS = 10_000;
const PLAYBACK_REFRESH_MS = 1_000;
const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;

// A <button> styled as a link doesn't inherit the surrounding text's font on its own.
const INLINE_BUTTON = { font: 'inherit', verticalAlign: 'baseline' } as const;

const megabytes = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

// Records the raw DDHQ + Chameleon responses the pollers fetch (once a minute), and plays
// a recording back in their place: Play clears live state and starts a fresh session on
// the recording; Stop playback does the same back onto the live APIs. Any recording, the
// one in progress included, opens read-only in ApiRecordingBrowser. Delete asks twice and
// isn't offered for the recording in progress or the one playing back.
const RecordPanel: React.FC<Props> = (props) => {
	const [name, setName] = React.useState('');
	const [msg, setMsg] = React.useState('');
	const [recordings, setRecordings] = React.useState<ApiRecordingSummary[]>([]);
	const [now, setNow] = React.useState(() => Date.now());
	const [browsing, setBrowsing] = React.useState<string | undefined>(undefined);
	const [speed, setSpeed] = React.useState<number>(1);
	const [confirmingDelete, setConfirmingDelete] = React.useState<string | undefined>(undefined);
	const recording = props.status?.mode === 'live' ? props.status.recording : null;
	const playback = props.status?.mode === 'playback' ? props.status : null;
	const playbackRunning = playback !== null && !playback.paused && !playback.ended;
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
			void onChange();
			void loadList();
		}, RECORDING_REFRESH_MS);
		return () => clearInterval(timer);
	}, [recording, onChange, loadList]);

	React.useEffect(() => {
		if (!playbackRunning) return undefined;
		const timer = setInterval(() => void onChange(), PLAYBACK_REFRESH_MS);
		return () => clearInterval(timer);
	}, [playbackRunning, onChange]);

	const start = async (): Promise<void> => {
		try {
			await api.startApiRecording(name.trim().length > 0 ? name.trim() : undefined);
			setName('');
			setMsg('');
			setNow(Date.now());
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'could not start');
		}
		await onChange();
		await loadList();
	};
	const stop = async (): Promise<void> => {
		await api.stopApiRecording();
		await onChange();
		await loadList();
	};
	const runPlayback = async (action: () => Promise<unknown>): Promise<void> => {
		try {
			await action();
			setMsg('');
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'playback failed');
		}
		await onChange();
		await loadList();
	};

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

	if (props.status === undefined)
		return (
			<Typography color="text.secondary" variant="body2">
				API recording not available.
			</Typography>
		);

	return (
		<Box>
			{playback !== null ? (
				<Box sx={{ mb: 1.5 }}>
					<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 0.5 }}>
						<Button
							onClick={() =>
								void runPlayback(() => api.playbackAction(playback.paused ? 'resume' : 'pause'))
							}
							size="small"
							variant="contained"
						>
							{playback.paused ? '▶ Resume' : '❚❚ Pause'}
						</Button>
						<Button
							onClick={() => void runPlayback(() => api.playbackAction('restart'))}
							size="small"
							variant="outlined"
						>
							↺ Restart
						</Button>
						<Button
							color="error"
							onClick={() => void runPlayback(() => api.playbackAction('stop'))}
							size="small"
							variant="outlined"
						>
							■ Stop playback
						</Button>
						<Typography variant="body2">
							Playing back <b>{playback.name}</b> at {playback.speed}× ·{' '}
							{minutes(playback.elapsedMs)} of {minutes(playback.durationMs)}
							{playback.paused ? ' · paused' : ''}
							{playback.ended ? ' · ended (last responses held)' : ''}
						</Typography>
						<Typography color="text.secondary" variant="caption">
							{msg}
						</Typography>
					</Stack>
					<Typography color="text.secondary" variant="caption">
						DDHQ and Chameleon answers come from the recording. Recording and query edits are off.
						Stop playback clears it and goes back to the live APIs.
					</Typography>
				</Box>
			) : (
				<>
					<Stack alignItems="center" direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1.5 }}>
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
								<Button color="error" onClick={() => void stop()} variant="outlined">
									■ Stop
								</Button>
								<Typography variant="body2">
									Recording <b>{recording.name}</b> ·{' '}
									{minutes(Math.max(0, now - recording.startedAt))} · {recording.responseCount}{' '}
									responses ·{' '}
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
					<Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="caption">
						Checks both APIs every 60 s while recording.
					</Typography>
				</>
			)}
			<Stack alignItems="center" direction="row" spacing={1} sx={{ mb: 1 }}>
				<Typography color="text.secondary" variant="caption">
					Play at
				</Typography>
				<ToggleButtonGroup
					exclusive={true}
					onChange={(_event, next: null | number) => setSpeed(next ?? speed)}
					size="small"
					value={speed}
				>
					{PLAYBACK_SPEEDS.map((option) => (
						<ToggleButton key={option} value={option}>
							{option}×
						</ToggleButton>
					))}
				</ToggleButtonGroup>
				<Typography color="text.secondary" variant="caption">
					Play clears the current races and alerts and starts a new session.
				</Typography>
			</Stack>
			{recordings.map((summary) => (
				<Box key={summary.file} sx={{ fontSize: 12, mb: 0.5 }}>
					<Button
						disabled={recording?.name === summary.name}
						onClick={() => void runPlayback(() => api.startApiPlayback(summary.name, speed))}
						size="small"
						sx={{ minWidth: 0, mr: 1, px: 1, py: 0 }}
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
					</Link>{' '}
					· {new Date(summary.startedAt).toLocaleString()} · {summary.responseCount} responses
					{summary.stoppedAt === null ? ' · in progress' : ''}
					{playback?.name === summary.name ? ' · playing' : ''}
					{recording?.name === summary.name ||
					playback?.name === summary.name ? null : confirmingDelete === summary.name ? (
						<>
							{' · '}
							<Link
								color="error"
								component="button"
								onClick={() => void remove(summary.name)}
								sx={{ ...INLINE_BUTTON, fontWeight: 700 }}
							>
								Delete recording
							</Link>{' '}
							<Link
								component="button"
								onClick={() => setConfirmingDelete(undefined)}
								sx={INLINE_BUTTON}
							>
								Cancel
							</Link>
						</>
					) : (
						<>
							{' · '}
							<Link
								color="error"
								component="button"
								onClick={() => setConfirmingDelete(summary.name)}
								sx={INLINE_BUTTON}
							>
								Delete
							</Link>
						</>
					)}
				</Box>
			))}
			<ApiRecordingBrowser
				inProgress={recording !== null && recording.name === browsing}
				name={browsing}
				onClose={() => setBrowsing(undefined)}
			/>
		</Box>
	);
};

export default RecordPanel;
