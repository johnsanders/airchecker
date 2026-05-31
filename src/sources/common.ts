export type RaceKeyParts = {
	contestType: string;
	district: null | string;
	office: string;
	party: null | string;
	state: string;
	year: number;
};

const slugify = (value: string): string => value.replace(/\s+/g, '_');

const composeRaceKey = (parts: RaceKeyParts): string => {
	const district = parts.district === null || parts.district.length === 0 ? 'AL' : parts.district;
	const party = parts.party === null || parts.party.length === 0 ? 'NP' : parts.party;
	return `${parts.year}-${parts.state}-${slugify(parts.office)}-${district}-${slugify(party)}-${slugify(parts.contestType)}`;
};

const partyLetter = (partyName: string): string => {
	const lookup: Record<string, string> = {
		Democratic: 'D',
		Green: 'G',
		Independent: 'I',
		Libertarian: 'L',
		Nonpartisan: 'NP',
		Republican: 'R',
	};
	return lookup[partyName] ?? partyName.charAt(0).toUpperCase();
};

export { composeRaceKey, partyLetter, slugify };
