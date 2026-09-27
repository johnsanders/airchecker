import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiRecordingWriter } from '../../src/replay/apiRecording.js';

import {
	listApiRecordings,
	listApiResponses,
	loadApiRecording,
	openApiRecordingWriter,
	readApiRecordingMeta,
	readApiResponseBody,
	stripOrigin,
} from '../../src/replay/apiRecording.js';

const dirs: string[] = [];
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), 'api-recording-'));
	dirs.push(dir);
	return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })));

// seq 1..5: DDHQ ok, Ross ok (non-ASCII), DDHQ error, Ross ok, DDHQ ok.
const fillNight = (writer: ApiRecordingWriter): void => {
	writer.append({ body: { page: 1 }, error: null, path: '/races?page=1', source: 'DDHQ', ts: 10 });
	writer.append({ body: { name: 'Peña' }, error: null, path: '/playlist', source: 'Ross', ts: 11 });
	writer.append({ body: null, error: 'HTTP 503', path: '/races?page=1', source: 'DDHQ', ts: 70 });
	writer.append({ body: { name: 'Lee' }, error: null, path: '/playlist', source: 'Ross', ts: 71 });
	writer.append({ body: { page: 1 }, error: null, path: '/races?page=1', source: 'DDHQ', ts: 130 });
};

describe('apiRecording', () => {
	it('round-trips responses in ts order, with error rows and final query list', () => {
		const baseDir = tempDir();
		const writer = openApiRecordingWriter(baseDir, {
			ddhqQueries: ['state=TX'],
			name: 'night',
			startedAt: 100,
		});
		writer.append({
			body: { page: 2 },
			error: null,
			path: '/api/v4/races?page=2',
			source: 'DDHQ',
			ts: 300,
		});
		writer.append({
			body: { page: 1 },
			error: null,
			path: '/api/v4/races?state=TX',
			source: 'DDHQ',
			ts: 200,
		});
		writer.append({
			body: null,
			error: 'HTTP 503 for x',
			path: '/playlist',
			source: 'Ross',
			ts: 250,
		});
		expect(writer.count()).toBe(3);
		writer.close(400, ['state=TX', 'state=GA']);

		const recording = loadApiRecording(writer.file);
		expect(recording.meta).toEqual({
			ddhqQueries: ['state=TX', 'state=GA'],
			name: 'night',
			startedAt: 100,
			stoppedAt: 400,
		});
		expect(recording.responses.map((row) => row.ts)).toEqual([200, 250, 300]);
		expect(recording.responses[1]).toEqual({
			body: null,
			error: 'HTTP 503 for x',
			path: '/playlist',
			source: 'Ross',
			ts: 250,
		});
		expect(recording.responses[0]?.body).toEqual({ page: 1 });
	});

	it('refuses to overwrite an existing recording', () => {
		const baseDir = tempDir();
		openApiRecordingWriter(baseDir, { ddhqQueries: [], name: 'dup', startedAt: 1 }).close(2, []);
		expect(() =>
			openApiRecordingWriter(baseDir, { ddhqQueries: [], name: 'dup', startedAt: 3 }),
		).toThrow(/already exists/);
	});

	it('lists recordings newest first with counts, and resolves names to files', () => {
		const baseDir = tempDir();
		const older = openApiRecordingWriter(baseDir, { ddhqQueries: [], name: 'older', startedAt: 1 });
		older.append({ body: {}, error: null, path: '/a', source: 'Ross', ts: 1 });
		older.close(2, []);
		openApiRecordingWriter(baseDir, { ddhqQueries: [], name: 'newer', startedAt: 5 }).close(6, []);
		expect(
			listApiRecordings(baseDir).map((summary) => [summary.name, summary.responseCount]),
		).toEqual([
			['newer', 0],
			['older', 1],
		]);
		expect(listApiRecordings(join(baseDir, 'missing'))).toEqual([]);
	});

	it('lists responses newest first without bodies, filtered and paged by seq', () => {
		const writer = openApiRecordingWriter(tempDir(), { ddhqQueries: [], name: 'n', startedAt: 1 });
		fillNight(writer);
		writer.close(200, []);
		const seqs = (query: Parameters<typeof listApiResponses>[1]): number[] =>
			listApiResponses(writer.file, query).map((row) => row.seq);

		expect(seqs({ limit: 10 })).toEqual([5, 4, 3, 2, 1]);
		expect(seqs({ limit: 2 })).toEqual([5, 4]);
		expect(seqs({ beforeSeq: 4, limit: 2 })).toEqual([3, 2]);
		expect(seqs({ limit: 10, source: 'Ross' })).toEqual([4, 2]);
		expect(seqs({ errorsOnly: true, limit: 10 })).toEqual([3]);
		expect(seqs({ errorsOnly: true, limit: 10, source: 'Ross' })).toEqual([]);

		const rows = listApiResponses(writer.file, { beforeSeq: 4, limit: 2 });
		expect(rows).toEqual([
			{ bytes: 0, error: 'HTTP 503', path: '/races?page=1', seq: 3, source: 'DDHQ', ts: 70 },
			{
				bytes: Buffer.byteLength('{"name":"Peña"}'),
				error: null,
				path: '/playlist',
				seq: 2,
				source: 'Ross',
				ts: 11,
			},
		]);
	});

	it('reads one stored body as text, null for an errored row or unknown seq', () => {
		const writer = openApiRecordingWriter(tempDir(), { ddhqQueries: [], name: 'n', startedAt: 1 });
		fillNight(writer);
		writer.close(200, []);
		expect(readApiResponseBody(writer.file, 2)).toBe('{"name":"Peña"}');
		expect(readApiResponseBody(writer.file, 3)).toBeNull();
		expect(readApiResponseBody(writer.file, 99)).toBeNull();
	});

	it('reads meta with per-source response and error counts', () => {
		const writer = openApiRecordingWriter(tempDir(), {
			ddhqQueries: ['state=TX'],
			name: 'night',
			startedAt: 1,
		});
		fillNight(writer);
		writer.close(200, ['state=TX', 'state=GA']);
		expect(readApiRecordingMeta(writer.file)).toEqual({
			ddhqQueries: ['state=TX', 'state=GA'],
			name: 'night',
			sources: [
				{ errors: 1, responses: 3, source: 'DDHQ' },
				{ errors: 0, responses: 2, source: 'Ross' },
			],
			startedAt: 1,
			stoppedAt: 200,
		});
	});

	it('reads a recording while the writer still has it open', () => {
		const writer = openApiRecordingWriter(tempDir(), {
			ddhqQueries: [],
			name: 'live',
			startedAt: 1,
		});
		expect(readApiRecordingMeta(writer.file)).toMatchObject({ sources: [], stoppedAt: null });
		fillNight(writer);
		expect(listApiResponses(writer.file, { limit: 10 }).map((row) => row.seq)).toEqual([
			5, 4, 3, 2, 1,
		]);
		expect(readApiResponseBody(writer.file, 1)).toBe('{"page":1}');
		writer.append({
			body: { page: 2 },
			error: null,
			path: '/races?page=2',
			source: 'DDHQ',
			ts: 131,
		});
		expect(listApiResponses(writer.file, { limit: 1 })[0]?.seq).toBe(6);
		expect(readApiRecordingMeta(writer.file).sources).toEqual([
			{ errors: 1, responses: 4, source: 'DDHQ' },
			{ errors: 0, responses: 2, source: 'Ross' },
		]);
		writer.close(200, []);
		expect(readApiRecordingMeta(writer.file).stoppedAt).toBe(200);
	});

	it('strips scheme and host but keeps path and query', () => {
		expect(stripOrigin('https://resultsapi.decisiondeskhq.com/api/v4/races?page=2')).toBe(
			'/api/v4/races?page=2',
		);
		expect(stripOrigin('http://txdaldc1nnr001.nexstar.tv/chameleon/x?format=json')).toBe(
			'/chameleon/x?format=json',
		);
	});
});
