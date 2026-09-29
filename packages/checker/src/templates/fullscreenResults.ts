import type { TemplateSpec } from './types.js';

// Full-screen results board. captureRegion stops at 70% of frame height — the
// cards end near 66% — so the headline chyron, the optional "DDHQ PROJECTION"
// band, and the ticker beneath stay out of the crop by construction. In
// the native geometry (layer exports, test feeds — see the reference-frames
// README) the board sits 42 px lower and the name plates end near 71%; the
// surnames and their ✓ are still inside, measured 18/18 on the nine exports.
const fullscreenResults: TemplateSpec = {
	captureRegion: { h: 0.7, w: 1, x: 0, y: 0 },
	id: 'fullscreen_results',
	surface: 'fullscreen',
	vlmPromptHint:
		'Full-screen results board filling the top two-thirds of the frame over a faded-stars background. A light header bar across the top: a state icon, the state abbreviation in blue and the office in black ("MI U.S. SENATE", "FL-22 U.S. HOUSE", "KS GOVERNOR"), a faint repeating state-name watermark, and at top-right a yellow reporting badge ("68% IN", ">95% IN") above a DD26 bug. Below: exactly TWO large candidate cards side by side — a big headshot on a party-colored panel (blue = D, red = R) with a white party-letter chip, a floating box with the percent (large) over the vote total (small), and a white name plate with the first name in small type above the SURNAME in large black type. A gold ✓ sits immediately RIGHT of the surname of a called candidate. A "Decision Desk HQ PROJECTION" band and/or a headline chyron may appear beneath the cards; neither is part of the race data and neither means a candidate was called.',
};

export default fullscreenResults;
