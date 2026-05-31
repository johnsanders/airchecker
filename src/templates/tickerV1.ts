import type { TemplateSpec } from './types.js';

// Persistent results ticker — a thin strip along the very bottom that FLIPS
// between races (no scroll), one race per flip. captureRegion bounds that strip;
// the VLM reads the heading, "% in", and the candidate entries from the crop.
const tickerV1: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
		raceKeyFrom: (singletons) => (singletons.race_heading ?? '').trim().toUpperCase(),
	},
	candidateList: {
		expectMax: 4,
		fields: [
			{ format: { kind: 'partyLabel' }, name: 'party', required: true },
			{ format: { kind: 'candidateName' }, name: 'name', required: true },
			{ format: { kind: 'integer' }, name: 'votes', required: true },
			{ format: { decimals: 1, kind: 'percent', max: 100, min: 0 }, name: 'pct', required: true },
			{ format: { kind: 'enum', values: ['', 'called'] }, name: 'called', required: false },
		],
		layout: 'row',
	},
	captureRegion: { h: 0.15, w: 1, x: 0, y: 0.85 },
	dataPath: 'vendor',
	displayName: 'Persistent results ticker',
	id: 'ticker_v1',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'ticker',
	vlmPromptHint:
		'Thin results strip across the very bottom: a race heading on the left (state box + office + party in parentheses), an "X% IN" badge, then one race\'s candidate entries — each with a party-color chip and letter, the candidate name, a percent, a vote total, and a yellow check mark when called. One race per flip; colors reflect party.',
};

export default tickerV1;
