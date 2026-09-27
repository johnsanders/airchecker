import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';
import type { ApiRecording, ApiResponseRow } from '../../src/replay/apiRecording.js';
import type { HttpJson } from '../../src/sources/http.js';

import { loadApiRecording } from '../../src/replay/apiRecording.js';
import { makeApiRecorder } from '../../src/runtime/apiRecorder.js';
import { makeDdhqAuth } from '../../src/sources/provider/auth.js';
import { makeProviderPoller } from '../../src/sources/provider/poller.js';
import {
	makePlaybackClock,
	makePlaybackHttp,
	makeRecordingHttp,
} from '../../src/sources/recordingHttp.js';
import { makeVendorPoller } from '../../src/sources/vendor/poller.js';

const here = dirname(fileURLToPath(import.meta.url));
const readSample = (file: string): Record<string, unknown> =>
	JSON.parse(readFileSync(resolve(here, '..', '..', file), 'utf8')) as Record<string, unknown>;
const ddhqSample = readSample('ddhq_response_example.json');
const chameleonSample = readSample('chameleon_response_example.json');

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })));

const routedHttp = (routes: Record<string, unknown>): HttpJson => ({
	getJson: async (url) => {
		const value = routes[url];
		if (value === undefined) throw new Error(`HTTP 404 for ${url}`);
		return value;
	},
	postJson: async () => ({ access_token: 'real-token', expires_in: 300 }),
});

const recordingOf = (responses: ApiResponseRow[]): ApiRecording => ({
	meta: { ddhqQueries: [], name: 'test', startedAt: responses[0]?.ts ?? 0, stoppedAt: null },
	responses,
});

const row = (
	ts: number,
	path: string,
	body: unknown,
	error: null | string = null,
): ApiResponseRow => ({
	body,
	error,
	path,
	source: 'Ross',
	ts,
});

const withoutClock = (observations: RaceObservation[]) =>
	observations.map((observation) => ({ ...observation, observedAt: 0 }));

describe('makeRecordingHttp', () => {
	it('records GETs (results and errors) with the origin stripped, but never the token POST', async () => {
		const rows: ApiResponseRow[] = [];
		const http = makeRecordingHttp(
			routedHttp({ 'https://a.test/ok?x=1': { ok: true } }),
			'DDHQ',
			(r) => rows.push(r),
			() => 42,
		);
		await http.getJson('https://a.test/ok?x=1');
		await expect(http.getJson('https://a.test/missing')).rejects.toThrow('HTTP 404');
		await http.postJson('https://a.test/api/v4/oauth/token', { client_secret: 'shh' });
		expect(rows).toEqual([
			{ body: { ok: true }, error: null, path: '/ok?x=1', source: 'DDHQ', ts: 42 },
			{
				body: null,
				error: 'HTTP 404 for https://a.test/missing',
				path: '/missing',
				source: 'DDHQ',
				ts: 42,
			},
		]);
	});

	it("records a failure's cause chain, not just fetch's bare message", async () => {
		const rows: ApiResponseRow[] = [];
		const http = makeRecordingHttp(
			{
				getJson: () =>
					Promise.reject(
						new TypeError('fetch failed', {
							cause: new Error('getaddrinfo ENOTFOUND chameleon.test'),
						}),
					),
				postJson: () => Promise.resolve({}),
			},
			'Ross',
			(r) => rows.push(r),
			() => 42,
		);
		await expect(http.getJson('http://chameleon.test/playlist')).rejects.toThrow('fetch failed');
		expect(rows.map((recorded) => recorded.error)).toEqual([
			'fetch failed (getaddrinfo ENOTFOUND chameleon.test)',
		]);
	});
});

describe('makePlaybackHttp', () => {
	it('serves the latest response at or before virtual time, scaled by speed', async () => {
		let wall = 1_000;
		const recording = recordingOf([
			row(0, '/p', 'first'),
			row(60_000, '/p', 'second'),
			row(120_000, '/p', 'third'),
		]);
		const clock = makePlaybackClock(recording, { now: () => wall, speed: 2 });
		const http = makePlaybackHttp(recording, 'Ross', clock);
		expect(await http.getJson('http://anyhost/p')).toBe('first');
		wall += 29_000; // 58 s of recording time — within the page lookahead of the second poll
		expect(await http.getJson('http://anyhost/p')).toBe('second');
		wall += 30_000; // 118 s
		expect(await http.getJson('http://anyhost/p')).toBe('third');
		expect(clock.ended()).toBe(false);
		wall += 10_000;
		expect(clock.ended()).toBe(true);
		expect(await http.getJson('http://anyhost/p')).toBe('third');
	});

	it('rethrows recorded errors, refuses unknown or not-yet-recorded paths, and fakes the token', async () => {
		let wall = 0;
		const recording = recordingOf([
			row(0, '/down', null, 'HTTP 503 for x'),
			row(600_000, '/late', 'later'),
		]);
		const http = makePlaybackHttp(
			recording,
			'Ross',
			makePlaybackClock(recording, { now: () => wall }),
		);
		await expect(http.getJson('http://h/down')).rejects.toThrow('HTTP 503 for x');
		await expect(http.getJson('http://h/never')).rejects.toThrow(/was not recorded/);
		await expect(http.getJson('http://h/late')).rejects.toThrow(/not recorded yet/);
		wall = 600_000;
		expect(await http.getJson('http://h/late')).toBe('later');
		expect(await http.postJson('http://h/api/v4/oauth/token', {})).toMatchObject({
			access_token: 'api-playback',
		});
	});

	it('ignores the other source’s rows', async () => {
		const recording = recordingOf([{ ...row(0, '/p', 'ddhq'), source: 'DDHQ' }]);
		const http = makePlaybackHttp(
			recording,
			'Ross',
			makePlaybackClock(recording, { now: () => 0 }),
		);
		await expect(http.getJson('http://h/p')).rejects.toThrow(/was not recorded/);
	});
});

describe('API record → playback round trip through the real pollers', () => {
	it('reproduces the live DDHQ (paginated, rebased) and Chameleon observations', async () => {
		const baseDir = mkdtempSync(join(tmpdir(), 'api-roundtrip-'));
		dirs.push(baseDir);
		const liveBase = 'https://live.test';
		const vendorUrl = 'http://vpn-only.test/chameleon/playlist?format=json';
		const pageOne = {
			...ddhqSample,
			data: (ddhqSample.data as unknown[]).slice(0, 4),
			next_page_url: 'other-host.test/api/v4/races?state=TX&page=2',
		};
		const pageTwo = {
			...ddhqSample,
			data: (ddhqSample.data as unknown[]).slice(4),
			next_page_url: null,
		};
		const upstream = routedHttp({
			[`${liveBase}/api/v4/races?state=TX&page=2`]: pageTwo,
			[`${liveBase}/api/v4/races?state=TX`]: pageOne,
			[vendorUrl]: chameleonSample,
		});

		const recorder = makeApiRecorder({ baseDir, getQueries: () => ['state=TX'], now: () => 1_000 });
		const pollBoth = async (ddhqHttp: HttpJson, vendorHttp: HttpJson, baseUrl: string) => {
			const observed: RaceObservation[] = [];
			const auth = makeDdhqAuth({
				baseUrl,
				credentials: { clientId: 'id', clientSecret: 's', grantType: 'g' },
				http: ddhqHttp,
			});
			const provider = makeProviderPoller({
				auth,
				baseUrl,
				getQueries: () => ['state=TX'],
				http: ddhqHttp,
				onObservations: (o) => observed.push(...o),
			});
			const vendor = makeVendorPoller({
				http: vendorHttp,
				onObservations: (o) => observed.push(...o),
				url: vendorUrl,
			});
			await provider.pollOnce();
			await vendor.pollOnce();
			return observed;
		};

		// Not recording yet: nothing is captured.
		await pollBoth(
			makeRecordingHttp(upstream, 'DDHQ', recorder.record),
			makeRecordingHttp(upstream, 'Ross', recorder.record),
			liveBase,
		);
		expect(recorder.start('night one')).toMatchObject({
			mode: 'live',
			recording: { name: 'night-one', responseCount: 0 },
		});
		const live = await pollBoth(
			makeRecordingHttp(upstream, 'DDHQ', recorder.record),
			makeRecordingHttp(upstream, 'Ross', recorder.record),
			liveBase,
		);
		expect(recorder.status()).toMatchObject({ recording: { responseCount: 3 } });
		expect(() => recorder.start()).toThrow(/already recording/);
		recorder.stop();
		expect(recorder.status()).toEqual({ mode: 'live', recording: null });

		const [summary] = recorder.list();
		expect(summary).toMatchObject({ name: 'night-one', responseCount: 3 });
		const recording = loadApiRecording(summary!.file);
		expect(recording.meta.ddhqQueries).toEqual(['state=TX']);

		const clock = makePlaybackClock(recording, { now: () => 0 });
		const played = await pollBoth(
			makePlaybackHttp(recording, 'DDHQ', clock),
			makePlaybackHttp(recording, 'Ross', clock),
			'https://resultsapi.decisiondeskhq.com',
		);
		expect(live.length).toBe(
			(ddhqSample.data as unknown[]).length +
				((chameleonSample.ElectionPlaylist as Record<string, unknown>).contest as unknown[]).length,
		);
		expect(withoutClock(played)).toEqual(withoutClock(live));
	});
});
