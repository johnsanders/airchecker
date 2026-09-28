// Air race keys come straight from the printed heading. The VLM renders the
// heading's divider inconsistently run to run ("VA | GOVERNOR" vs "VA GOVERNOR")
// and occasionally drags the adjacent reporting badge into it ("AZ U.S. HOUSE 45 IN");
// the identity resolver would treat each variant as a different source race, so
// normalize before keying. Some models (Gemini Flash, measured 2026-09-26) write
// the heading's line break as the two characters backslash-n; treat that as
// whitespace too, or the key fails the state-code guard and the read is dropped.
const TRAILING_BADGE = /\s*>?\d+(?:\.\d+)?\s*%?\s*\.?\s*IN\s*$/i;
const LITERAL_NEWLINE = /\\n/gi;

export const headingRaceKey = (singletons: Record<string, string>): string =>
	(singletons.race_heading ?? '')
		.replace(LITERAL_NEWLINE, ' ')
		.replace(TRAILING_BADGE, '')
		.replace(/\|/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
