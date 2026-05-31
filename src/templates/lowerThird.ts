import type { TemplateSpec } from './types.js';

// Lower-third "RACE ALERT" strip across the bottom. captureRegion bounds the
// whole strip (RACE ALERT tag → race block → candidate cells); the VLM reads the
// heading, "% in", and the cells (2–3, extending rightward) from the crop.
const lowerThird: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
		raceKeyFrom: (singletons) => (singletons.race_heading ?? '').trim().toUpperCase(),
	},
	candidateList: {
		expectMax: 5,
		fields: [
			{ format: { kind: 'partyLabel' }, name: 'party', required: true },
			{ format: { kind: 'candidateName' }, name: 'name', required: true },
			{ format: { decimals: 1, kind: 'percent', max: 100, min: 0 }, name: 'pct', required: true },
			{ format: { kind: 'integer' }, name: 'votes', required: true },
			{ format: { kind: 'enum', values: ['', 'called'] }, name: 'called', required: false },
		],
		layout: 'row',
	},
	captureRegion: { h: 0.36, w: 1, x: 0, y: 0.64 },
	dataPath: 'vendor',
	displayName: 'Lower-third race alert',
	id: 'lower_third',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'lower_third',
	vlmPromptHint:
		'HORIZONTAL strip spanning the BOTTOM edge of the screen, candidates laid out LEFT-TO-RIGHT. Its signature is a "RACE ALERT" tag at the far left, then a colored race block (state-district + office + party in parentheses, with "X% IN"), then 2+ candidate cells running rightward, and a "NEWS FOR ALL AMERICANS" / DD26 promo bar beneath. Each cell: headshot, party-color chip with party letter, candidate name, percent, vote total, and a yellow check mark when called. Choose this (NOT side_slab) whenever you see "RACE ALERT" or a wide bottom strip — side_slab is a tall panel on the RIGHT edge, never along the bottom.',
};

export default lowerThird;
