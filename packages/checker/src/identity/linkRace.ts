import type { RaceObservation } from '../reconcile/reconcile.js';

import { airHeadingMatches, parseAirHeading } from './airHeading.js';

// The races an observation can be about: the latest thing DDHQ said of each race it has
// reported, and the latest thing Ross said of each race DDHQ hasn't.
export type KnownRaces = {
	provider: readonly RaceObservation[];
	vendor: readonly RaceObservation[];
};

const oneThatFits = (
	races: readonly RaceObservation[],
	fits: (race: RaceObservation) => boolean,
): 'none' | 'several' | RaceObservation => {
	const fitting = races.filter(fits);
	return fitting.length === 0 ? 'none' : fitting.length === 1 ? fitting[0]! : 'several';
};

// Says which race an observation is about, from the races known so far. Nothing is
// remembered between calls.
//   DDHQ  its own key.
//   Ross  the DDHQ race whose race_id the Chameleon contest names, else its own key, which
//         composeRaceKey builds the same way for both.
//   air   the one DDHQ race its heading and a surname fit (airHeading.ts). When none does,
//         the one race only Ross has reported that fits: a DDHQ outage, or a race missing
//         from the DDHQ queries, must not stop a graphic being held against its feed. A
//         heading that fits no race, or several, keeps the heading as its key: the read is
//         not linked, so not compared.
export const linkObservation = (
	observation: RaceObservation,
	known: KnownRaces,
): RaceObservation => {
	const sourceRaceKey = observation.sourceRaceKey ?? observation.raceKey;
	const { providerRaceId, ...unlinked } = { ...observation, raceKey: sourceRaceKey, sourceRaceKey };

	if (observation.source === 'DDHQ')
		return { ...observation, raceKey: sourceRaceKey, sourceRaceKey };

	if (observation.source === 'Ross') {
		const named =
			providerRaceId === undefined
				? undefined
				: known.provider.find((race) => race.providerRaceId === providerRaceId);
		return { ...observation, raceKey: named?.raceKey ?? sourceRaceKey, sourceRaceKey };
	}

	const heading = parseAirHeading(sourceRaceKey);
	if (heading === undefined) return unlinked;
	const names = observation.candidates.map((candidate) => candidate.name);
	const fits = (race: RaceObservation): boolean =>
		airHeadingMatches(
			heading,
			names,
			race.raceKey,
			race.candidates.map((candidate) => candidate.name),
		);
	const reported = oneThatFits(known.provider, fits);
	const race = reported === 'none' ? oneThatFits(known.vendor, fits) : reported;
	if (race === 'none' || race === 'several') return unlinked;
	return {
		...unlinked,
		...(race.providerRaceId === undefined ? {} : { providerRaceId: race.providerRaceId }),
		raceKey: race.raceKey,
	};
};
