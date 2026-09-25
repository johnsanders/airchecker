import type { TemplateSpec } from './types.js';

import { headingRaceKey } from './headingKey.js';

// Full-screen results board. Pass 1 sees the whole frame; captureRegion is used
// ONLY by the recall (call-detection) pass. It stops at 70% of frame height — the
// cards end near 66% — so the headline chyron, the optional "DDHQ PROJECTION"
// band, and the ticker beneath stay out of the recall crop by construction.
const fullscreenResults: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
		// Air reads state/office (and district, party) from the heading; year and
		// contest type are session constants. The identity resolver links this raw
		// key to the DDHQ canonical race.
		raceKeyFrom: headingRaceKey,
	},
	candidateList: {
		expectMax: 2,
		fields: [
			{ format: { kind: 'partyLabel' }, name: 'party', required: true },
			{ format: { kind: 'candidateName' }, name: 'name', required: true },
			{ format: { decimals: 1, kind: 'percent', max: 100, min: 0 }, name: 'pct', required: true },
			{ format: { kind: 'integer' }, name: 'votes', required: true },
			{ format: { kind: 'enum', values: ['', 'called'] }, name: 'called', required: false },
		],
		layout: 'row',
	},
	captureRegion: { h: 0.7, w: 1, x: 0, y: 0 },
	dataPath: 'vendor',
	displayName: 'Fullscreen results board',
	id: 'fullscreen_results',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'fullscreen',
	vlmPromptHint:
		'Full-screen results board filling the top two-thirds of the frame over a faded-stars background. A light header bar across the top: a state icon, the state abbreviation in blue and the office in black ("MI U.S. SENATE", "FL-22 U.S. HOUSE", "KS GOVERNOR"), a faint repeating state-name watermark, and at top-right a yellow reporting badge ("68% IN", ">95% IN") above a DD26 bug. Below: exactly TWO large candidate cards side by side — a big headshot on a party-colored panel (blue = D, red = R) with a white party-letter chip, a floating box with the percent (large) over the vote total (small), and a white name plate with the first name in small type above the SURNAME in large black type. A gold ✓ sits immediately RIGHT of the surname of a called candidate. A "Decision Desk HQ PROJECTION" band and/or a headline chyron may appear beneath the cards; neither is part of the race data and neither means a candidate was called.',
};

export default fullscreenResults;
