import type { TemplateSpec } from './types.js';

// Full-screen results board. Pass 1 sees the whole frame; captureRegion is used
// ONLY by the recall (call-detection) pass. It's the top ~74% — the board itself,
// excluding the bottom strip where a ticker/lower-third can coexist (see
// multi.png). Cropping the recall image above that strip keeps a simultaneous
// ticker's check mark out of the fullscreen call read by construction, instead of
// relying on name-matching to filter it out. Verified: all candidate cards + ✓'s
// (even the 5-card layout) fit above y=0.74. The VLM reads the heading, "% in",
// and the 2–5 reflowing cards. Party-agnostic — cards recolor per party.
const fullscreenResults: TemplateSpec = {
	bind: {
		candidateKeyFrom: (candidate) => candidate.name ?? '',
		// Air reads state/office/party (and district) from the heading; year and
		// contest type are session constants. The air adapter composes the canonical
		// composeRaceKey from these parts + that session context.
		raceKeyFrom: (singletons) => (singletons.race_heading ?? '').trim().toUpperCase(),
	},
	candidateList: {
		expectMax: 8,
		fields: [
			{ format: { kind: 'partyLabel' }, name: 'party', required: true },
			{ format: { kind: 'candidateName' }, name: 'name', required: true },
			{ format: { decimals: 1, kind: 'percent', max: 100, min: 0 }, name: 'pct', required: true },
			{ format: { kind: 'integer' }, name: 'votes', required: true },
			{ format: { kind: 'enum', values: ['', 'called'] }, name: 'called', required: false },
		],
		layout: 'row',
	},
	captureRegion: { h: 0.74, w: 1, x: 0, y: 0 },
	dataPath: 'vendor',
	displayName: 'Fullscreen results board',
	id: 'fullscreen_results',
	singletons: [
		{ format: { kind: 'text' }, name: 'race_heading', required: true },
		{ format: { decimals: 0, kind: 'percent', max: 100, min: 0 }, name: 'pct_in', required: true },
	],
	surface: 'fullscreen',
	vlmPromptHint:
		'Full-screen results board: race heading top-left (state + office + party in parentheses), a yellow "X% IN" badge top-right, and a horizontal row of 2–5 candidate cards over a faded-stars background. Each card has a party-colored header chip with the party letter, a headshot, the candidate name, a large percent, a vote total, and a yellow check mark when the candidate is called/advancing.',
};

export default fullscreenResults;
