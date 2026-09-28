import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import type { Race, RaceCandidate } from '../air/races.js';

import { ddhqBaseUrl } from '../settings.js';
import { makeDdhqAuth } from '../sources/ddhqAuth.js';
import { makeFetchHttp } from '../sources/http.js';

// Builds races.json, the simulated air feed's race list, from takeitems.xml (the operator's
// Ross take list for the L3 and FS results graphics). The take list names each race but
// carries no candidates, so each one is looked up once in DDHQ's Nov 3 general races. What
// the simulator's DDHQ and Chameleon mirrors need to build their responses is kept too.
// Run from packages/simulator: node --env-file-if-exists=../../.env --import tsx src/tools/buildRaces.ts

const RACE_DATE = '2026-11-03';

// Ross group ids in the take list; the ticker (1) is data-driven and names no races.
const GRAPHIC_BY_GROUP: Record<string, Graphic> = { '2': 'l3', '3': 'fs' };

// The take list's office names, with DDHQ's office_id and office name for each. The name is
// checked too: the Governor query also returns Lt Governor races.
const OFFICES: Record<string, { id: number; name: string }> = {
	Governor: { id: 2, name: 'Governor' },
	'U.S. House': { id: 3, name: 'US House' },
	'U.S. Senate': { id: 4, name: 'US Senate' },
};

// The checker's partyLetter mapping, so the letters agree with what it derives.
const PARTY_ABBREVIATIONS: Record<string, string> = {
	Democratic: 'D',
	Green: 'G',
	Independent: 'I',
	Libertarian: 'L',
	Nonpartisan: 'NP',
	Republican: 'R',
};

type Graphic = Race['graphics'][number];

type TakeItem = { district: string; graphic: Graphic; office: string; stateName: string };

const ddhqRaceSchema = z.object({
	candidates: z.array(
		z.object({
			cand_id: z.number(),
			first_name: z.string().nullable(),
			incumbent: z.boolean(),
			last_name: z.string(),
			party_name: z.string(),
		}),
	),
	district: z.string().nullable(),
	level: z.string(),
	name: z.string(),
	office: z.string(),
	race_id: z.number(),
	state: z.string(),
	state_name: z.string(),
	year: z.number(),
});

const ddhqPageSchema = z.object({
	data: z.array(ddhqRaceSchema),
	next_page_url: z.string().nullable(),
});

type DdhqRace = z.infer<typeof ddhqRaceSchema>;

// Each <template> carries its fields as one pipe-delimited content attribute:
// ENABLE MANUAL | NUM OF CANDS | RACE ID | STATE | OFFICE | PRIMARY? | DISTRICT | ...
const parseTakeItems = (xml: string): TakeItem[] =>
	[...xml.matchAll(/<template [^>]*content="([^"]*)"[^>]*groupid="(\d+)"/g)].flatMap((match) => {
		const graphic = GRAPHIC_BY_GROUP[match[2] ?? ''];
		const fields = (match[1] ?? '').split(' | ');
		if (graphic === undefined) return [];
		const district = fields[6] ?? '*';
		return [
			{
				district: district === '*' ? '' : district,
				graphic,
				office: fields[4] ?? '',
				stateName: fields[3] ?? '',
			},
		];
	});

const raceKey = (item: { district: string; office: string; stateName: string }) =>
	`${item.stateName}/${item.office}/${item.district}`;

const fetchOffice = async (
	officeId: number,
	getToken: () => Promise<string>,
): Promise<DdhqRace[]> => {
	const http = makeFetchHttp();
	const fetchPage = async (url: string): Promise<DdhqRace[]> => {
		const page = ddhqPageSchema.parse(
			await http.getJson(url, { Authorization: `Bearer ${await getToken()}` }),
		);
		// next_page_url comes back without a scheme.
		return page.next_page_url === null
			? page.data
			: [...page.data, ...(await fetchPage(`https://${page.next_page_url}`))];
	};
	return fetchPage(
		`${ddhqBaseUrl('production')}/api/v4/races?race_date=${RACE_DATE}&office_id=${officeId}&limit=250`,
	);
};

const toCandidate = (candidate: DdhqRace['candidates'][number]): RaceCandidate => ({
	candId: candidate.cand_id,
	// preferred_name is usually '' when unset, and sometimes a full legal name, so first_name it is.
	first: (candidate.first_name ?? '').trim(),
	incumbent: candidate.incumbent,
	last: candidate.last_name.trim(),
	party:
		PARTY_ABBREVIATIONS[candidate.party_name] ?? candidate.party_name.slice(0, 1).toUpperCase(),
	partyName: candidate.party_name,
});

const readCredentials = () => {
	const clientId = process.env.DDHQ_CLIENT_ID;
	const clientSecret = process.env.DDHQ_CLIENT_SECRET;
	const grantType = process.env.DDHQ_GRANT_TYPE;
	if (clientId === undefined || clientSecret === undefined || grantType === undefined)
		throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');
	return { clientId, clientSecret, grantType };
};

const main = async () => {
	const items = parseTakeItems(readFileSync('takeitems.xml', 'utf8'));
	const itemsByKey = items.reduce((grouped, item) => {
		grouped.set(raceKey(item), [...(grouped.get(raceKey(item)) ?? []), item]);
		return grouped;
	}, new Map<string, TakeItem[]>());

	const auth = makeDdhqAuth({
		getBaseUrl: () => ddhqBaseUrl('production'),
		getCredentials: readCredentials,
		http: makeFetchHttp(),
	});
	const ddhqByKey = new Map(
		(
			await Promise.all(
				Object.entries(OFFICES).map(async ([office, ddhqOffice]) =>
					(await fetchOffice(ddhqOffice.id, auth.getToken))
						.filter((race) => race.office === ddhqOffice.name)
						.map((race) => ({ office, race })),
				),
			)
		)
			.flat()
			.map((entry) => [
				raceKey({
					district: entry.race.district ?? '',
					office: entry.office,
					stateName: entry.race.state_name,
				}),
				entry.race,
			]),
	);

	const unmatched = [...itemsByKey.keys()].filter((key) => !ddhqByKey.has(key));
	if (unmatched.length > 0) {
		console.error(`${unmatched.length} take-list races not found in DDHQ; races.json not written:`);
		unmatched.forEach((key) => console.error(`  ${key}`));
		process.exitCode = 1;
		return;
	}

	const races: Race[] = [...itemsByKey.entries()].map(([key, group]) => {
		const first = group[0] as TakeItem;
		const ddhq = ddhqByKey.get(key) as DdhqRace;
		return {
			candidates: ddhq.candidates.map(toCandidate),
			ddhq: {
				level: ddhq.level,
				name: ddhq.name,
				office: ddhq.office,
				raceId: ddhq.race_id,
				year: ddhq.year,
			},
			district: first.district,
			graphics: [...new Set(group.map((item) => item.graphic))].sort(),
			key,
			office: first.office,
			state: ddhq.state,
			stateName: first.stateName,
		};
	});

	writeFileSync('races.json', `${JSON.stringify(races, null, '\t')}\n`);
	console.log(`${races.length} races from ${items.length} take items`);
};

void main();
