import type { TemplateSpec } from './types.js';

import { headingRaceKey } from './headingKey.js';

// Boxed results panel keyed over programming in the lower third, sitting just
// above the always-on ticker. captureRegion bounds the box with slack on every
// edge and stops above the ticker's candidate text so the recall crop can't pick
// up the ticker's ✓; the VLM reads the heading, "% in", and the two cells.
const lowerThird: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
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
	captureRegion: { h: 0.245, w: 0.8, x: 0.17, y: 0.665 },
	dataPath: 'vendor',
	displayName: 'Lower-third results panel',
	id: 'lower_third',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'lower_third',
	vlmPromptHint:
		'A BOXED results panel (thin white border) keyed over programming in the lower third, spanning roughly the middle three-quarters of the frame width and sitting just ABOVE the bottom ticker strip. Inside, left to right: a dark-blue race block with the state and district in large type ("AL-2", "AR"), the office beneath ("U.S. HOUSE", "GOVERNOR"), and the reporting figure ("76% IN") at the bottom — a share of precincts, never a district number; then exactly TWO candidate cells, each with a headshot on a party-colored square carrying a party-letter chip, the first name in small type stacked above the SURNAME in large party-colored type, and a party-colored bar with the percent (large) and the vote total (small, no separators). A gold ✓ sits immediately LEFT of the surname of a called candidate. No "RACE ALERT" tag, no promo bar. It is NOT the red or blue headline chyron ("DEVELOPING STORY", "BREAKING NEWS", a name super, a show promo) that occupies the same band — those show no candidate numbers and must be ignored.',
};

export default lowerThird;
