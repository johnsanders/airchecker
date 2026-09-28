// Links an air race to its DDHQ race without a model call, when the graphic's heading
// says exactly which race it is. The heading key (headingKey.ts) reads like
// "TX-15 U.S. HOUSE", "OK U.S. SENATE" or "TX U.S. SENATE (D)"; a DDHQ race key reads
// like "2026-TX-US_House-15-NP-General_Election" (composeRaceKey in sources/common.ts).
// A heading matches a race when state, office, district and party agree, and every
// surname the graphic showed is on that race's ballot. The surname check is what keeps a
// misread district ("TX-16" for "TX-15") from linking to the wrong race.

export type AirHeading = { district: string; office: string; party: string; state: string };

// Office names compare with punctuation and spacing dropped: "U.S. HOUSE" = "US_House".
const compact = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const AT_LARGE = 'AL';
const NO_PARTY = 'NP';

export const parseAirHeading = (headingKey: string): AirHeading | undefined => {
	const match = /^([A-Z]{2})(?:-(\d+|AL))?\s+(.+?)(?:\s+\(([A-Z]+)\))?$/.exec(headingKey.trim());
	if (match === null) return undefined;
	return {
		district: match[2] ?? AT_LARGE,
		office: compact(match[3] ?? ''),
		party: match[4] ?? NO_PARTY,
		state: match[1] ?? '',
	};
};

// year-state-office-district-party-contest; the office slug may itself contain dashes.
const parseRaceKey = (raceKey: string): AirHeading | undefined => {
	const parts = raceKey.split('-');
	if (parts.length < 6) return undefined;
	return {
		district: parts.at(-3) ?? '',
		office: compact(parts.slice(2, -3).join('-')),
		party: parts.at(-2) ?? '',
		state: parts[1] ?? '',
	};
};

const surname = (name: string): string =>
	name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[^a-z ]/g, '')
		.trim()
		.split(/\s+/)
		.at(-1) ?? '';

export const airHeadingMatches = (
	heading: AirHeading,
	airCandidateNames: readonly string[],
	raceKey: string,
	raceCandidateNames: readonly string[],
): boolean => {
	const race = parseRaceKey(raceKey);
	if (race === undefined) return false;
	// "D" in a primary heading is the party's first letter; a general race has no party.
	const partyAgrees =
		heading.party === NO_PARTY ? race.party === NO_PARTY : race.party.startsWith(heading.party);
	const ballot = raceCandidateNames.map((name) =>
		name
			.toLowerCase()
			.normalize('NFD')
			.replace(/[^a-z]/g, ''),
	);
	return (
		race.state === heading.state &&
		race.office === heading.office &&
		race.district === heading.district &&
		partyAgrees &&
		airCandidateNames.length > 0 &&
		airCandidateNames.every((name) => {
			const last = surname(name);
			return last.length > 0 && ballot.some((full) => full.includes(last));
		})
	);
};
