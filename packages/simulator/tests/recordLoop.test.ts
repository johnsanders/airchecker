import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { HttpJson } from '../src/sources/http.js';

import { makeApiRecorder } from '../src/recording/apiRecorder.js';
import { loadApiRecording } from '../src/recording/apiRecording.js';
import { makeRecordingHttp } from '../src/recording/recordingHttp.js';
import { makeRecordLoop } from '../src/recording/recordLoop.js';
import { makeDdhqAuth } from '../src/sources/ddhqAuth.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })));

const LIVE = 'https://resultsapi.decisiondeskhq.com';
const VENDOR = 'http://vpn-only.test/chameleon/playlist/?format=json';

const routedHttp = (routes: Record<string, unknown>, headersSeen: string[] = []): HttpJson => ({
	getJson: async (url, headers) => {
		headersSeen.push(headers?.Authorization ?? '');
		const value = routes[url];
		if (value === undefined) throw new Error(`HTTP 404 for ${url}`);
		return value;
	},
	postJson: async () => ({ access_token: 'real-token', expires_in: 300 }),
});

describe('makeRecordLoop', () => {
	it('records every DDHQ page (rebased) and the Chameleon playlist, never the token POST', async () => {
		const baseDir = mkdtempSync(join(tmpdir(), 'record-loop-'));
		dirs.push(baseDir);
		const headersSeen: string[] = [];
		const upstream = routedHttp(
			{
				[`${LIVE}/api/v4/races?state=TX&page=2`]: { data: [2], next_page_url: null },
				[`${LIVE}/api/v4/races?state=TX`]: {
					data: [1],
					next_page_url: 'other-host.test/api/v4/races?state=TX&page=2',
				},
				[VENDOR]: { contests: [] },
			},
			headersSeen,
		);
		const recorder = makeApiRecorder({ baseDir, getQueries: () => ['state=TX'], now: () => 5 });
		const ddhqHttp = makeRecordingHttp(upstream, 'DDHQ', recorder.record, () => 7);
		const loop = makeRecordLoop({
			auth: makeDdhqAuth({
				getBaseUrl: () => LIVE,
				getCredentials: () => ({ clientId: 'id', clientSecret: 's', grantType: 'g' }),
				http: ddhqHttp,
			}),
			chameleonUrl: VENDOR,
			ddhqHttp,
			getSettings: () => ({
				environment: 'production',
				intervalSeconds: 60,
				queries: ['state=TX', 'state=ZZ'],
			}),
			vendorHttp: makeRecordingHttp(upstream, 'Ross', recorder.record, () => 8),
		});

		recorder.start('night');
		await loop.tickOnce();
		recorder.stop();

		expect(headersSeen.filter((header) => header === 'Bearer real-token')).toHaveLength(3);
		expect(loop.errors()).toEqual([`DDHQ state=ZZ: HTTP 404 for ${LIVE}/api/v4/races?state=ZZ`]);
		const recording = loadApiRecording(recorder.list()[0]!.file);
		expect(
			recording.responses.map((row) => [row.source, row.path, row.error === null]).sort(),
		).toEqual([
			['DDHQ', '/api/v4/races?state=TX&page=2', true],
			['DDHQ', '/api/v4/races?state=TX', true],
			['DDHQ', '/api/v4/races?state=ZZ', false],
			['Ross', '/chameleon/playlist/?format=json', true],
		]);
	});

	it('reports a token failure without recording anything for DDHQ', async () => {
		const failingAuth = makeDdhqAuth({
			getBaseUrl: () => LIVE,
			getCredentials: () => {
				throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');
			},
			http: routedHttp({}),
		});
		const rows: unknown[] = [];
		const loop = makeRecordLoop({
			auth: failingAuth,
			chameleonUrl: VENDOR,
			ddhqHttp: makeRecordingHttp(routedHttp({}), 'DDHQ', (row) => rows.push(row)),
			getSettings: () => ({
				environment: 'production',
				intervalSeconds: 60,
				queries: ['state=TX'],
			}),
			vendorHttp: makeRecordingHttp(routedHttp({ [VENDOR]: {} }), 'Ross', (row) => rows.push(row)),
		});
		await loop.tickOnce();
		expect(loop.errors()).toEqual([
			'DDHQ state=TX: DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set',
		]);
		expect(rows).toHaveLength(1);
	});
});
