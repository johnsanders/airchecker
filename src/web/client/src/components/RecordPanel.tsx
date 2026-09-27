import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { ApiRecordingStatus, ApiRecordingSummary } from '../api.js';

import { api } from '../api.js';
import ApiRecordingBrowser from './ApiRecordingBrowser.js';

interface Props {
	onChange: () => Promise<void>;
	status: ApiRecordingStatus | undefined;
}

// Response counts grow on every 60 s poll without a change nudge, so refresh while recording.
const RECORDING_REFRESH_MS = 10_000;

// A <button> styled as a link doesn't inherit the surrounding text's font on its own.
const INLINE_BUTTON = { font: 'inherit', verticalAlign: 'baseline' } as const;

const minutes = (ms: number): string =>
	`${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;

// Records the raw DDHQ + Chameleon responses the pollers fetch (once a minute), so a
// night can be replayed later with `npm run backend -- --api-playback <name>`. Any
// recording, the one in progress included, opens read-only in ApiRecordingBrowser.
const RecordPanel: React.FC<Props> = (props) => {
	const [name, setName] = React.useState('');
	const [msg, setMsg] = React.useState('');
	const [recordings, setRecordings] = React.useState<ApiRecordingSummary[]>([]);
	const [now, setNow] = React.useState(() => Date.now());
	const [browsing, setBrowsing] = React.useState<string | undefined>(undefined);
	const recording = props.status?.mode === 'live' ? props.status.recording : null;
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

	if (props.status === undefined)
		return (
			<Typography color="text.secondary" variant="body2">
				API recording not available.
			</Typography>
		);

	return (
		<Box>
			{props.status.mode === 'playback' ? (
				<Box sx={{ mb: 1.5 }}>
					<Typography variant="body2">
						Playing back <b>{props.status.name}</b> at {props.status.speed}× ·{' '}
						{minutes(props.status.elapsedMs)} of {minutes(props.status.durationMs)}
						{props.status.ended ? ' · ended (last responses held)' : ''}
					</Typography>
					<Typography color="text.secondary" variant="caption">
						DDHQ and Chameleon answers come from the recording. Recording and query edits are off.
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
			{recordings.map((summary) => (
				<Box key={summary.file} sx={{ fontSize: 12, mb: 0.5 }}>
					<Link
						component="button"
						onClick={() => setBrowsing(summary.name)}
						sx={{ ...INLINE_BUTTON, fontWeight: 700 }}
					>
						{summary.name}
					</Link>{' '}
					· {new Date(summary.startedAt).toLocaleString()} · {summary.responseCount} responses
					{summary.stoppedAt === null ? ' · in progress' : ''}
					<Box component="code" sx={{ color: 'text.secondary', display: 'block' }}>
						npm run backend -- --api-playback {summary.name} --speed=1
					</Box>
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
