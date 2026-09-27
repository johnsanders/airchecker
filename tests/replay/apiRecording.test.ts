import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	listApiRecordings,
	loadApiRecording,
	openApiRecordingWriter,
	resolveApiRecordingFile,
	stripOrigin,
} from '../../src/replay/apiRecording.js';

const dirs: string[] = [];
const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), 'api-recording-'));
	dirs.push(dir);
	return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })));

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
		expect(resolveApiRecordingFile(baseDir, 'older')).toBe(older.file);
		expect(listApiRecordings(join(baseDir, 'missing'))).toEqual([]);
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
