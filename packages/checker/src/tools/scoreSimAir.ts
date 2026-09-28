import Database from 'better-sqlite3';
import { join } from 'node:path';
import { z } from 'zod';

import type { RaceObservation } from '../reconcile/reconcile.js';

import makePlayer from '../replay/player.js';

// Scores a session captured from the simulator's air feed (/air/) against what actually
// aired. The simulator answers /api/air/aired?ts= with the graphics on screen at any
// moment of a night it ran, so each frame's reads are checked field by field: heading,
// % in, each candidate's name, percent and votes, and the ✓. Run it while the simulator
// that aired the night is still up (it keeps its nights in memory).
//
// The page trails the schedule by up to about a second (its 500 ms poll, then a render), so
// a frame captured just after a cut may still show the previous graphic. Graphics cut, never
// blend, so each graphic is scored against whichever of the two (at capture, and --lag
// earlier) its read matches best.
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/scoreSimAir.ts <sessionId> [--sim URL] [--lag MS]
//     --lag: how far behind the capture the page may be (default 1500 ms)

type Kind = 'fs' | 'l3' | 'ticker';

const KIND_BY_TEMPLATE: Record<string, Kind> = {
	fullscreen_results: 'fs',
	lower_third: 'l3',
	ticker_v1: 'ticker',
};

const FIELDS = ['heading', 'pctIn', 'names', 'votes', 'pct', 'called'] as const;

type Field = (typeof FIELDS)[number];

const graphicCandidateSchema = z.object({
	isWinner: z.boolean(),
	name: z.string(),
	party: z.string(),
	votePercent: z.number(),
	votes: z.number(),
});

const graphicDataSchema = z.object({
	cand1: graphicCandidateSchema,
	cand2: graphicCandidateSchema,
	pctIn: z.string(),
	race: z.string(),
	state: z.string(),
});

const airedSchema = z.object({
	onAir: z
		.object({
			overlay: z.object({ data: graphicDataSchema, kind: z.enum(['fs', 'l3']) }).nullable(),
			ticker: z.object({ data: graphicDataSchema }),
		})
		.nullable(),
});

type GraphicData = z.infer<typeof graphicDataSchema>;

type Tally = {
	checks: Record<Field, { right: number; total: number }>;
	found: number;
	missed: number;
	phantom: number;
	stale: number; // read matched the graphic from before a cut
};

const emptyTally = (): Tally => ({
	checks: Object.fromEntries(
		FIELDS.map((field) => [field, { right: 0, total: 0 }]),
	) as Tally['checks'],
	found: 0,
	missed: 0,
	phantom: 0,
	stale: 0,
});

const flag = (name: string): string | undefined => {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
};

const normalizeHeading = (text: string): string =>
	text
		.toUpperCase()
		.replace(/[^A-Z0-9-]+/g, ' ')
		.trim();

const normalizeName = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, '');

const expectedByKind = (
	onAir: z.infer<typeof airedSchema>['onAir'],
): Record<Kind, GraphicData | undefined> => ({
	fs: onAir?.overlay?.kind === 'fs' ? onAir.overlay.data : undefined,
	l3: onAir?.overlay?.kind === 'l3' ? onAir.overlay.data : undefined,
	ticker: onAir?.ticker.data,
});

const pctInMatches = (expected: string, observation: RaceObservation): boolean => {
	if (expected === '>95') return observation.pctIn === 95 && observation.pctInIsMinimum === true;
	if (expected === '<1') return observation.pctIn <= 1;
	return observation.pctIn === Number(expected) && observation.pctInIsMinimum !== true;
};

// Each field's verdict for one graphic, and a note for each wrong one.
const compare = (
	expected: GraphicData,
	observation: RaceObservation,
): { field: Field; note?: string; right: boolean }[] => {
	const heading = observation.sourceRaceKey ?? observation.raceKey;
	const expectedHeading = `${expected.state} ${expected.race}`;
	const candidates = [expected.cand1, expected.cand2].map((candidate) => ({
		expected: candidate,
		read: observation.candidates.find(
			(read) => normalizeName(read.name) === normalizeName(candidate.name.replace('|', ' ')),
		),
	}));
	const found = candidates.flatMap((pair) =>
		pair.read === undefined ? [] : [{ expected: pair.expected, read: pair.read }],
	);
	const verdict = (field: Field, right: boolean, note: string) =>
		right ? { field, right } : { field, note, right };
	return [
		verdict(
			'heading',
			normalizeHeading(heading) === normalizeHeading(expectedHeading),
			`${expectedHeading} → ${heading}`,
		),
		verdict(
			'pctIn',
			pctInMatches(expected.pctIn, observation),
			`${expected.pctIn} → ${observation.pctIn}${observation.pctInIsMinimum === true ? ' (min)' : ''}`,
		),
		...candidates.map((pair) =>
			verdict(
				'names',
				pair.read !== undefined,
				`${pair.expected.name} → ${observation.candidates.map((read) => read.name).join(' / ')}`,
			),
		),
		...found.map((pair) =>
			verdict(
				'votes',
				pair.read.votes === Math.round(pair.expected.votes),
				`${pair.expected.name} ${Math.round(pair.expected.votes)} → ${pair.read.votes}`,
			),
		),
		...found.map((pair) =>
			verdict(
				'pct',
				Math.abs(pair.read.pct - Number(pair.expected.votePercent.toFixed(1))) < 0.05,
				`${pair.expected.name} ${pair.expected.votePercent.toFixed(1)} → ${pair.read.pct}`,
			),
		),
		...found.map((pair) =>
			verdict(
				'called',
				pair.expected.isWinner === observation.calledFor.includes(pair.read.key),
				`${pair.expected.name} called ${pair.expected.isWinner} → ${observation.calledFor.includes(pair.read.key)}`,
			),
		),
	];
};

const main = async () => {
	const sessionId = process.argv[2];
	if (sessionId === undefined || sessionId.startsWith('--'))
		throw new Error('usage: scoreSimAir.ts <sessionId> [--sim URL] [--lag MS]');
	const simUrl = flag('--sim') ?? 'http://localhost:8788';
	const lagMs = Number(flag('--lag') ?? 1500);

	const aired = async (ts: number) =>
		expectedByKind(
			airedSchema.parse(await (await fetch(`${simUrl}/api/air/aired?ts=${Math.round(ts)}`)).json())
				.onAir,
		);

	// A frame with no model call never finished being read (e.g. the session stopped
	// mid-extraction); its lack of reads says nothing about the extractor.
	const db = new Database(join('recordings', `${sessionId}.sqlite`), { readonly: true });
	const readHashes = new Set(
		db
			.prepare('SELECT DISTINCT frame_hash AS frameHash FROM llm_calls')
			.all()
			.map((row) => (row as { frameHash: string }).frameHash),
	);
	db.close();
	const player = makePlayer({ baseDir: 'recordings', sessionId });
	const allFrames = player.readFrames();
	const frames = allFrames.filter((frame) => readHashes.has(frame.frameHash));
	const airReads = player.readObservations().filter((observation) => observation.source === 'air');
	player.close();

	const tallies: Record<Kind, Tally> = { fs: emptyTally(), l3: emptyTally(), ticker: emptyTally() };
	const mistakes: string[] = [];
	let offAir = 0;

	await frames.reduce(async (previous, frame) => {
		await previous;
		const [now, before] = await Promise.all([aired(frame.ts), aired(frame.ts - lagMs)]);
		if (now.ticker === undefined && before.ticker === undefined) {
			offAir += 1;
			return;
		}
		const reads = airReads.filter((observation) => observation.observedAt === frame.ts);
		(['ticker', 'l3', 'fs'] as const).forEach((kind) => {
			const tally = tallies[kind];
			const read = reads.find(
				(observation) => KIND_BY_TEMPLATE[observation.templateId ?? ''] === kind,
			);
			const onScreen = now[kind];
			const possible =
				JSON.stringify(onScreen) === JSON.stringify(before[kind])
					? [onScreen]
					: [onScreen, before[kind]];
			const shown = possible.flatMap((data) => (data === undefined ? [] : [data]));
			if (read === undefined) {
				// Only a miss if something was on screen whichever side of a cut the frame fell.
				if (onScreen !== undefined && shown.length === possible.length) {
					tally.missed += 1;
					mistakes.push(`${frame.path} ${kind}: missed ${onScreen.state} ${onScreen.race}`);
				}
				return;
			}
			if (shown.length === 0) {
				tally.phantom += 1;
				mistakes.push(
					`${frame.path} ${kind}: read ${read.sourceRaceKey ?? read.raceKey} but nothing aired`,
				);
				return;
			}
			const scored = shown
				.map((data) => ({ data, verdicts: compare(data, read) }))
				.reduce((best, next) =>
					next.verdicts.filter((verdict) => verdict.right).length >
					best.verdicts.filter((verdict) => verdict.right).length
						? next
						: best,
				);
			tally.found += 1;
			if (scored.data !== onScreen) tally.stale += 1;
			scored.verdicts.forEach((verdict) => {
				tally.checks[verdict.field].total += 1;
				if (verdict.right) tally.checks[verdict.field].right += 1;
				else mistakes.push(`${frame.path} ${kind} ${verdict.field}: ${verdict.note ?? ''}`);
			});
		});
	}, Promise.resolve());

	console.log(
		`${sessionId}: ${frames.length} frames scored (${allFrames.length - frames.length} never read, ${offAir} with no night on air), lag ${lagMs} ms\n`,
	);
	(['ticker', 'l3', 'fs'] as const).forEach((kind) => {
		const tally = tallies[kind];
		const fields = FIELDS.map((field) => {
			const check = tally.checks[field];
			return `${field} ${check.right}/${check.total}`;
		}).join(', ');
		console.log(
			`${kind.padEnd(6)} found ${tally.found}, missed ${tally.missed}, phantom ${tally.phantom}, ${tally.stale} still showing the graphic from before a cut`,
		);
		console.log(`       ${fields}`);
	});
	if (mistakes.length > 0) {
		console.log(`\n${mistakes.length} mistakes:`);
		mistakes.forEach((mistake) => console.log(`  ${mistake}`));
	}
};

void main();
