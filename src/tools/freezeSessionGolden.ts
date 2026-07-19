import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionGoldenDoc } from '../replay/sessionGolden.js';

import makePlayer from '../replay/player.js';
import { replaySessionTimeline } from '../replay/sessionGolden.js';

// Freezes a recorded session into a self-contained golden doc — observations +
// identity events + the expectations replaySessionTimeline derives from them —
// so the replay test can re-run the store/reconciler path with no sqlite and
// no API key.
//
//   npm run freeze-session -- <sessionId> <goldenName>
//   npm run freeze-session -- --refreeze <path-to-session.json>

const writeDoc = (outPath: string, doc: SessionGoldenDoc): void => {
	// Compact JSON — the doc is megabytes of observation payloads.
	writeFileSync(outPath, `${JSON.stringify(doc)}\n`);
	const batches = new Set(doc.observations.map((observation) => observation.observedAt)).size;
	const sizeMb = (statSync(outPath).size / (1024 * 1024)).toFixed(2);
	console.log(
		`${doc.name}: ${doc.observations.length} obs / ${batches} batches, ` +
			`${doc.expected.store.raceCount} races, ${doc.expected.distinctAnomalies.length} distinct + ` +
			`${doc.expected.finalAnomalies.length} final anomalies, ${sizeMb}MB → ${outPath}`,
	);
};

const freeze = (sessionId: string, goldenName: string): void => {
	const player = makePlayer({ baseDir: 'recordings', sessionId });
	const observations = player.readObservations();
	const identityEvents = player.readIdentityEvents();
	player.close();

	const expected = replaySessionTimeline({ identityEvents, observations });
	const span = observations.reduce(
		(acc, observation) => ({
			from: Math.min(acc.from, observation.observedAt),
			to: Math.max(acc.to, observation.observedAt),
		}),
		{ from: Number.POSITIVE_INFINITY, to: Number.NEGATIVE_INFINITY },
	);

	const outDir = join('recordings', 'goldens', 'sessions');
	mkdirSync(outDir, { recursive: true });
	const doc: SessionGoldenDoc = {
		expected,
		identityEvents,
		name: goldenName,
		observations,
		sessionId,
		span,
	};
	writeDoc(join(outDir, `${goldenName}.session.json`), doc);
};

const refreeze = (docPath: string): void => {
	const doc = JSON.parse(readFileSync(docPath, 'utf8')) as SessionGoldenDoc;
	const expected = replaySessionTimeline({
		identityEvents: doc.identityEvents,
		observations: doc.observations,
	});
	writeDoc(docPath, { ...doc, expected });
};

const run = (): void => {
	const first = process.argv[2];
	const second = process.argv[3];
	if (first === undefined || second === undefined) {
		console.error(
			'Usage: npm run freeze-session -- <sessionId> <goldenName>\n' +
				'       npm run freeze-session -- --refreeze <path-to-session.json>',
		);
		process.exit(1);
	}
	if (first === '--refreeze') refreeze(second);
	else freeze(first, second);
};

run();
