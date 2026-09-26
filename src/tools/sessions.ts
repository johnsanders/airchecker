import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import makePlayer from '../replay/player.js';

// Lists recorded sessions with what they hold and what they cost on disk, and
// prunes the frame PNGs of sessions that are no longer needed. Frames are the
// bulk (~1 GB per broadcast hour at the default cadence); the sqlite keeps the
// observations, LLM calls, identity and alert events, so a pruned session still
// replays and freezes — only capture-golden --from-session needs the PNGs.
//
//   npm run sessions                         list sessions (newest last)
//   npm run sessions -- --prune-frames <id>  delete recordings/<id>/frames (keeps the sqlite)

const BASE = 'recordings';

const dirSize = (path: string): number =>
	existsSync(path)
		? readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
				const full = join(path, entry.name);
				return total + (entry.isDirectory() ? dirSize(full) : statSync(full).size);
			}, 0)
		: 0;

const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

const listSessions = (): void => {
	const ids = readdirSync(BASE)
		.filter((file) => file.endsWith('.sqlite') && file !== 'settings.sqlite')
		.map((file) => file.replace(/\.sqlite$/, ''))
		.sort();
	console.log(['session', 'obs', 'frames', 'llm', 'alerts', 'sqlite', 'frames on disk'].join('\t'));
	ids.forEach((id) => {
		const player = makePlayer({ baseDir: BASE, sessionId: id });
		const observations = player.readObservations().length;
		const frames = player.readFrames().length;
		const alerts = player.readAlertEvents().length;
		player.close();
		const sqlite = statSync(join(BASE, `${id}.sqlite`)).size;
		const framesDir = join(BASE, id, 'frames');
		console.log(
			[id, observations, frames, '-', alerts, mb(sqlite), mb(dirSize(framesDir))].join('\t'),
		);
	});
};

const pruneFrames = (id: string): void => {
	const framesDir = join(BASE, id, 'frames');
	if (!existsSync(framesDir)) {
		console.error(`no frames directory for ${id}`);
		process.exit(1);
	}
	const before = dirSize(framesDir);
	rmSync(framesDir, { force: true, recursive: true });
	console.log(`pruned ${framesDir} (${mb(before)}); the session sqlite is untouched`);
};

const run = (): void => {
	const [flag, id] = process.argv.slice(2);
	if (flag === undefined) {
		listSessions();
		return;
	}
	if (flag === '--prune-frames' && id !== undefined) {
		pruneFrames(id);
		return;
	}
	console.error('Usage: npm run sessions [-- --prune-frames <sessionId>]');
	process.exit(1);
};

run();
