import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React from 'react';

import type { DiskUsage, SessionSummary } from '../api.js';

import { api } from '../api.js';

// Frames grow ~1 GB per broadcast hour; a six-hour night needs ~6 GB, so warn with
// headroom to spare. Disk and sizes change without a change nudge, so poll.
const LOW_DISK_BYTES = 10 * 1024 ** 3;
const REFRESH_MS = 60_000;

const size = (bytes: number): string =>
	bytes >= 1024 ** 3
		? `${(bytes / 1024 ** 3).toFixed(1)} GB`
		: `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const when = (ts: null | number): string => (ts === null ? '—' : new Date(ts).toLocaleString());

type Confirming = { action: 'delete' | 'prune'; id: string };

// Recorded sessions under recordings/: free disk, what each session holds, pruning a
// session's frame PNGs (its sqlite still replays and freezes), and deleting a session.
const SessionsPanel: React.FC = () => {
	const [disk, setDisk] = React.useState<DiskUsage | undefined>(undefined);
	const [sessions, setSessions] = React.useState<SessionSummary[]>([]);
	const [confirming, setConfirming] = React.useState<Confirming | undefined>(undefined);
	const [msg, setMsg] = React.useState('');

	const load = React.useCallback(async (): Promise<void> => {
		try {
			const response = await api.getSessions();
			setDisk(response.disk);
			setSessions(response.sessions);
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'could not load sessions');
		}
	}, []);
	React.useEffect(() => {
		void load();
		const timer = setInterval(() => void load(), REFRESH_MS);
		return () => clearInterval(timer);
	}, [load]);

	const prune = async (id: string): Promise<void> => {
		setConfirming(undefined);
		try {
			const response = await api.pruneSessionFrames(id);
			setMsg(`pruned ${id} (${size(response.freedBytes)} freed)`);
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'could not prune');
		}
		await load();
	};

	const remove = async (id: string): Promise<void> => {
		setConfirming(undefined);
		try {
			const response = await api.deleteSession(id);
			setMsg(`deleted ${id} (${size(response.freedBytes)} freed)`);
		} catch (error) {
			setMsg(error instanceof Error ? error.message : 'could not delete');
		}
		await load();
	};

	const current = sessions.find((session) => session.current);
	const low = disk !== undefined && disk.freeBytes < LOW_DISK_BYTES;

	return (
		<Box>
			<Typography
				color={low ? 'error' : 'text.primary'}
				sx={{ fontWeight: low ? 700 : 400 }}
				variant="body2"
			>
				Disk:{' '}
				{disk === undefined ? '—' : `${size(disk.freeBytes)} free of ${size(disk.totalBytes)}`}
				{current === undefined
					? ''
					: ` · this session ${size(current.framesBytes + current.sqliteBytes)}`}
				{low ? ' · LOW: prune old sessions' : ''}
			</Typography>
			<Typography color="text.secondary" sx={{ display: 'block', mb: 1 }} variant="caption">
				Frames take ~1 GB per broadcast hour. Pruning deletes a session's frame PNGs; it still
				replays and freezes. Deleting removes the whole session. {msg}
			</Typography>
			<Table size="small">
				<TableHead>
					<TableRow>
						<TableCell>Session</TableCell>
						<TableCell>Started</TableCell>
						<TableCell align="right">Obs</TableCell>
						<TableCell align="right">Frames</TableCell>
						<TableCell align="right">Alerts</TableCell>
						<TableCell align="right">sqlite</TableCell>
						<TableCell align="right">Frames on disk</TableCell>
						<TableCell />
					</TableRow>
				</TableHead>
				<TableBody>
					{[...sessions].reverse().map((session) => (
						<TableRow key={session.id}>
							<TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
								{session.id}
								{session.current ? ' (recording)' : ''}
							</TableCell>
							<TableCell>{when(session.startedAt)}</TableCell>
							<TableCell align="right">{session.observations}</TableCell>
							<TableCell align="right">{session.frames}</TableCell>
							<TableCell align="right">{session.alerts}</TableCell>
							<TableCell align="right">{size(session.sqliteBytes)}</TableCell>
							<TableCell align="right">{size(session.framesBytes)}</TableCell>
							<TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
								{session.current ? null : confirming?.id === session.id ? (
									<>
										<Button
											color="error"
											onClick={() =>
												void (confirming.action === 'prune'
													? prune(session.id)
													: remove(session.id))
											}
											size="small"
										>
											{confirming.action === 'prune' ? 'Delete frames' : 'Delete session'}
										</Button>
										<Button onClick={() => setConfirming(undefined)} size="small">
											Cancel
										</Button>
									</>
								) : (
									<>
										{session.framesBytes === 0 ? null : (
											<Button
												onClick={() => setConfirming({ action: 'prune', id: session.id })}
												size="small"
											>
												Prune
											</Button>
										)}
										<Button
											color="error"
											onClick={() => setConfirming({ action: 'delete', id: session.id })}
											size="small"
										>
											Delete
										</Button>
									</>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Box>
	);
};

export default SessionsPanel;
