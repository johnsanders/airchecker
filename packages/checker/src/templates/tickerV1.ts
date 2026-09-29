import type { TemplateSpec } from './types.js';

// Persistent results ticker — a thin strip along the very bottom that FLIPS
// between races (no scroll), one race per flip, ~10 s per race. captureRegion
// bounds that strip with slack above it (the real graphics can sit a few pixels
// off the reference frames); the VLM reads the heading, "% in", and the two
// candidate blocks from the crop.
const tickerV1: TemplateSpec = {
	captureRegion: { h: 0.13, w: 1, x: 0, y: 0.87 },
	id: 'ticker_v1',
	surface: 'ticker',
	vlmPromptHint:
		'Thin LIGHT-GRAY strip along the very BOTTOM edge of the frame (always on air during coverage). Left: a dark-blue race heading — the state abbreviation, a thin vertical divider, then the office, with the party letter in parentheses for primaries (e.g. "TX | U.S. SENATE (D)", "VA | GOVERNOR"); House races add a smaller second line such as "DISTRICT 7". Then a small dark-blue badge with the reporting figure ("84% IN", or ">95% IN" once nearly complete). Then exactly TWO candidate blocks filled with the party color (blue = D, red = R): a white party-letter chip, the first name in small type stacked above the SURNAME in large type, and the percent (large) over the vote total (small, with thousands separators) right-aligned. A gold ✓ sits immediately LEFT of the surname of a called candidate. The strip flips between races; a frame caught mid-flip shows two races sliced together.',
};

export default tickerV1;
