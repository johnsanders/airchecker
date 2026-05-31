import makePlayer from '../replay/player.js';
import makeComposition from './composition.js';

export type ReplayOptions = {
	baseDir?: string;
	sessionId: string;
};

const replayMain = async (options: ReplayOptions): Promise<void> => {
	const baseDir = options.baseDir ?? 'recordings';
	const player = makePlayer({ baseDir, sessionId: options.sessionId });
	const composition = makeComposition();

	player.emitObservationsInto(composition.store.record);

	const raceKeys = composition.store.getRaceKeys();
	console.log(`[replay] session ${options.sessionId}: ${raceKeys.length} race(s)`);
	raceKeys.forEach((raceKey) => {
		const anomalies = composition.reconcileRace(raceKey, Date.now());
		console.log(`  ${raceKey}: ${anomalies.length} anomaly/anomalies`);
		anomalies.forEach((anomaly) => {
			console.log(`    [${anomaly.severity}] ${anomaly.type} — ${anomaly.detail}`);
		});
	});

	player.close();
};

if (import.meta.url === `file://${process.argv[1]}`) {
	const sessionId = process.argv[2];
	if (sessionId === undefined) {
		console.error('usage: replayMain <sessionId> [baseDir]');
		process.exit(1);
	}
	const baseDir = process.argv[3];
	const opts: ReplayOptions = baseDir === undefined ? { sessionId } : { baseDir, sessionId };
	replayMain(opts).catch((error: unknown) => {
		console.error('[replay] fatal', error);
		process.exit(1);
	});
}

export default replayMain;
