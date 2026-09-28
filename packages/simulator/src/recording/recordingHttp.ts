import type { HttpJson } from '../sources/http.js';
import type { ApiResponseRow, ApiSource } from './apiRecording.js';

import { errorMessage } from '../sources/http.js';
import { stripOrigin } from './apiRecording.js';

// GETs only: the OAuth token POST is never recorded, so no credentials or tokens land on disk.
export const makeRecordingHttp = (
	inner: HttpJson,
	source: ApiSource,
	record: (row: ApiResponseRow) => void,
	now: () => number = Date.now,
): HttpJson => ({
	getJson: async (url, headers) => {
		try {
			const body = await inner.getJson(url, headers);
			record({ body, error: null, path: stripOrigin(url), source, ts: now() });
			return body;
		} catch (error) {
			record({ body: null, error: errorMessage(error), path: stripOrigin(url), source, ts: now() });
			throw error;
		}
	},
	postJson: inner.postJson,
});
