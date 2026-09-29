import type { ApiResponseRow } from './recording/apiRecording.js';

import { makeAirShow } from './air/airShow.js';
import { makeLiveResults } from './air/liveResults.js';
import { loadRaces } from './air/races.js';
import { makeApiPlayback } from './playback/apiPlayback.js';
import { makeApiRecorder } from './recording/apiRecorder.js';
import { makeRecordingHttp } from './recording/recordingHttp.js';
import { makeRecordLoop } from './recording/recordLoop.js';
import { DDHQ_INTEGRATION_URL, makeSettingsStore } from './settings.js';
import { makeDdhqAuth } from './sources/ddhqAuth.js';
import { makeFetchHttp } from './sources/http.js';
import { makeWebServer } from './web/server.js';

// Simulator server: records DDHQ's integration host and the Chameleon API, and plays
// recordings back on mirror endpoints. Env: DDHQ_CLIENT_ID / DDHQ_CLIENT_SECRET /
// DDHQ_GRANT_TYPE (recording and a live-DDHQ-integration night), PORT (default 8788).

const RECORDINGS_DIR = 'recordings';

const readCredentials = () => {
	const clientId = process.env.DDHQ_CLIENT_ID;
	const clientSecret = process.env.DDHQ_CLIENT_SECRET;
	const grantType = process.env.DDHQ_GRANT_TYPE;
	if (clientId === undefined || clientSecret === undefined || grantType === undefined)
		throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');
	return { clientId, clientSecret, grantType };
};

const main = async (): Promise<void> => {
	const settings = makeSettingsStore('settings.json');
	const fetchHttp = makeFetchHttp();
	// A closure, not recorder.record directly: the loop's HTTP is built before the
	// recorder that starts the loop, and only calls it once a recording is running.
	const record = (row: ApiResponseRow) => recorder.record(row);
	const ddhqHttp = makeRecordingHttp(fetchHttp, 'DDHQ', record);
	const recordLoop = makeRecordLoop({
		auth: makeDdhqAuth({
			getBaseUrl: () => DDHQ_INTEGRATION_URL,
			getCredentials: readCredentials,
			http: ddhqHttp,
		}),
		ddhqHttp,
		getSettings: settings.get,
		vendorHttp: makeRecordingHttp(fetchHttp, 'Ross', record),
	});
	const recorder = makeApiRecorder({
		baseDir: RECORDINGS_DIR,
		getQueries: () => settings.get().queries,
		onStart: recordLoop.start,
		onStop: recordLoop.stop,
	});
	const races = loadRaces('races.json');
	const liveResults = makeLiveResults({
		auth: makeDdhqAuth({
			getBaseUrl: () => DDHQ_INTEGRATION_URL,
			getCredentials: readCredentials,
			http: fetchHttp,
		}),
		http: fetchHttp,
		races,
	});
	const airShow = makeAirShow({
		getAirSource: () => settings.get().airSource,
		liveResults,
		races,
	});
	const web = makeWebServer({
		airShow,
		playback: makeApiPlayback({ airFeed: airShow.feed, baseDir: RECORDINGS_DIR }),
		recorder,
		recordErrors: recordLoop.errors,
		settings,
	});
	const port = Number(process.env.PORT) || 8788;
	await web.listen({ port });
	console.log(`[simulator] http://localhost:${port}`);
};

void main();
