// Air race keys come straight from the printed heading. The VLM renders the
// heading's divider inconsistently run to run ("VA | GOVERNOR" vs "VA GOVERNOR")
// and occasionally drags the adjacent reporting badge into it ("AZ U.S. HOUSE 45 IN");
// the identity resolver would treat each variant as a different source race, so
// normalize before keying.
const TRAILING_BADGE = /\s*>?\d+(?:\.\d+)?\s*%?\s*\.?\s*IN\s*$/i;

export const headingRaceKey = (singletons: Record<string, string>): string =>
	(singletons.race_heading ?? '')
		.replace(TRAILING_BADGE, '')
		.replace(/\|/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
