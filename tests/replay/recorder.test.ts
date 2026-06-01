import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CandidateState, RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';

import makePlayer from '../../src/replay/player.js';
import makeRecorder, { sha256Hex } from '../../src/replay/recorder.js';

const candidate = (key: string, votes: number): CandidateState => ({
	key,
	name: `Candidate ${key}`,
	party: 'D',
	pct: 50,
	votes,
});

const observation = (
	source: SourceName,
	at: number,
	votes: number,
	raceKey = 'TEST:RACE',
): RaceObservation => ({
	calledFor: [],
	candidates: [candidate('A', votes), candidate('B', votes / 2)],
	observedAt: at,
	pctIn: 42,
	raceKey,
	reportedAt: at,
	source,
});

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-recorder-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

describe('recorder + player round-trip', () => {
	it('writes observations and reads them back in insertion order', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-1' });
		const inputs = [
			observation('DDHQ', 1_000, 100),
			observation('Ross', 1_001, 100),
			observation('air', 1_002, 100),
			observation('DDHQ', 2_000, 200),
		];
		inputs.forEach(recorder.recordObservation);
		recorder.close();

		const player = makePlayer({ baseDir, sessionId: 'sess-1' });
		const replayed = player.readObservations();
		player.close();

		expect(replayed).toHaveLength(inputs.length);
		expect(replayed).toEqual(inputs);
	});

	it('emits observations into a sink in order', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-2' });
		recorder.recordObservation(observation('DDHQ', 1_000, 100));
		recorder.recordObservation(observation('air', 1_001, 100));
		recorder.close();

		const player = makePlayer({ baseDir, sessionId: 'sess-2' });
		const sink: RaceObservation[] = [];
		player.emitObservationsInto((obs) => sink.push(obs));
		player.close();

		expect(sink.map((obs) => obs.source)).toEqual(['DDHQ', 'air']);
	});
});

describe('recorder frame storage', () => {
	it('content-addresses frames and dedupes identical bytes', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-3' });
		const png = Buffer.from('not-a-real-png-but-deterministic');
		const expectedHash = sha256Hex(png);
		const hashA = recorder.recordFrame({ height: 1080, png, ts: 1_000, width: 1920 });
		const hashB = recorder.recordFrame({ png, ts: 2_000 });
		recorder.close();

		expect(hashA).toBe(expectedHash);
		expect(hashB).toBe(expectedHash);
		const expectedPath = join(baseDir, 'sess-3', 'frames', `${expectedHash}.png`);
		expect(existsSync(expectedPath)).toBe(true);
		expect(readFileSync(expectedPath)).toEqual(png);

		const player = makePlayer({ baseDir, sessionId: 'sess-3' });
		const frames = player.readFrames();
		player.close();
		expect(frames).toHaveLength(2);
		expect(frames[0]!.frameHash).toBe(expectedHash);
		expect(frames[0]!.width).toBe(1920);
		expect(frames[1]!.width).toBeNull();
	});
});

describe('recorder llm lookup', () => {
	it('records llm calls and looks them up by (frameHash, promptHash)', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-4' });
		recorder.recordLlmCall({
			frameHash: 'frame-abc',
			model: 'claude-haiku-4-5',
			promptHash: 'prompt-xyz',
			request: { kind: 'detect', templateId: 'tickerV1' },
			response: { confidence: 0.97, present: true },
			ts: 1_000,
		});
		recorder.recordLlmCall({
			frameHash: null,
			model: 'claude-sonnet-4-6',
			promptHash: 'prompt-text-only',
			request: { kind: 'judge' },
			response: { verdict: 'real' },
			ts: 1_500,
		});

		const withFrame = recorder.lookupLlm('frame-abc', 'prompt-xyz');
		expect(withFrame).toEqual({
			model: 'claude-haiku-4-5',
			response: { confidence: 0.97, present: true },
		});

		const noFrame = recorder.lookupLlm(null, 'prompt-text-only');
		expect(noFrame).toEqual({
			model: 'claude-sonnet-4-6',
			response: { verdict: 'real' },
		});

		expect(recorder.lookupLlm('frame-abc', 'unknown-prompt')).toBeUndefined();
		expect(recorder.lookupLlm('unknown-frame', 'prompt-xyz')).toBeUndefined();
		expect(recorder.lookupLlm(null, 'prompt-xyz')).toBeUndefined();

		recorder.close();
	});
});

describe('recorder identity events', () => {
	it('records and replays race identity events', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-identity' });
		recorder.recordIdentityEvent({
			payload: {
				canonicalRaceKey: 'DDHQ:RACE',
				method: 'manual',
				source: 'air',
				sourceRaceKey: 'AIR HEADING',
				updatedAt: 1_000,
			},
			type: 'alias_upsert',
		});
		recorder.close();

		const player = makePlayer({ baseDir, sessionId: 'sess-identity' });
		expect(player.readIdentityEvents()).toEqual([
			{
				payload: {
					canonicalRaceKey: 'DDHQ:RACE',
					method: 'manual',
					source: 'air',
					sourceRaceKey: 'AIR HEADING',
					updatedAt: 1_000,
				},
				type: 'alias_upsert',
			},
		]);
		player.close();
	});
});
