import type { TemplateSpec } from './types.js';

// Side slab — a vertical results panel docked to the right side. captureRegion
// bounds that panel; the VLM reads the heading, "% in", and the stacked candidate
// rows (2–3, growing downward) from the crop. Party-agnostic (blue/D in samples).
const sideSlab: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
		raceKeyFrom: (singletons) => (singletons.race_heading ?? '').trim().toUpperCase(),
	},
	candidateList: {
		expectMax: 6,
		fields: [
			{ format: { kind: 'partyLabel' }, name: 'party', required: true },
			{ format: { kind: 'candidateName' }, name: 'name', required: true },
			{ format: { decimals: 1, kind: 'percent', max: 100, min: 0 }, name: 'pct', required: true },
			{ format: { kind: 'integer' }, name: 'votes', required: true },
			{ format: { kind: 'enum', values: ['', 'called'] }, name: 'called', required: false },
		],
		layout: 'column',
	},
	captureRegion: { h: 0.94, w: 0.29, x: 0.71, y: 0.03 },
	dataPath: 'vendor',
	displayName: 'Side slab results panel',
	id: 'side_slab',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'side_slab',
	vlmPromptHint:
		'TALL VERTICAL panel docked to the RIGHT edge of the screen, candidates STACKED TOP-TO-BOTTOM. Race heading at the top (state-district + office + party in parentheses) with a small "X% IN" badge, then a downward column of 2+ candidate rows. Each row has a headshot, a party-color chip with the party letter, the candidate surname, a percent and a vote total. Choose this only for a vertical right-side column — if the graphic is a wide strip along the BOTTOM or shows a "RACE ALERT" tag, it is lower_third, not side_slab.',
};

export default sideSlab;
