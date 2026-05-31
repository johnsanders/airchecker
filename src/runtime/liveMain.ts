import { randomUUID } from 'node:crypto';

import makeRecorder from '../replay/recorder.js';
import makeComposition from './composition.js';

const liveMain = async (): Promise<void> => {
	const sessionId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	const recorder = makeRecorder({ baseDir: 'recordings', sessionId });
	const composition = makeComposition({
		onRecord: recorder.recordObservation,
	});

	const shutdown = (): void => {
		recorder.close();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Pollers (provider / vendor / air) wire in here once endpoints + capturer are settled.
	// For now: scaffold runs, records nothing until a source is hooked up.
	console.log(
		`[live] session ${sessionId} ready; ${composition.store.getRaceKeys().length} races tracked. Waiting for sources.`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
