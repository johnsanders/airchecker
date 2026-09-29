import { describe, expect, it } from 'vitest';

import type { LlmClient, LlmRequest } from '../../src/vision/llmClient.js';

import { templateRegistry } from '../../src/templates/registry.js';
import { extractFrame } from '../../src/vision/extractFrame.js';

const FRAME = Buffer.from('fake-png-bytes');

type Row = { called?: string; name: string; party: string; pct: string; votes: string };

// Fixtures name each candidate once; the tool returns the two printed lines separately.
const read = (raceHeading: string, pctIn: string, rows: Row[]): unknown => ({
	candidates: rows.map(({ called, name, ...rest }) => {
		const [firstName = '', ...surname] = name.split(' ');
		return { ...rest, called: called ?? '', firstName, surname: surname.join(' ') };
	}),
	pctIn,
	raceHeading,
});

const NOTHING = { candidates: [], pctIn: '', raceHeading: '' };

const PAXTON: Row = {
	called: 'called',
	name: 'Ken Paxton',
	party: 'R',
	pct: '63.8%',
	votes: '885,949',
};
const CORNYN: Row = { name: 'John Cornyn', party: 'R', pct: '36.2%', votes: '501,725' };

// Which template's region a request is reading: its prompt carries that template's hint.
const templateOf = (request: LlmRequest): string =>
	templateRegistry.find((spec) => request.prompt.includes(spec.vlmPromptHint))!.id;

// A model that sees the given graphic in each named template's region and nothing elsewhere.
const seeing = (byTemplate: Record<string, unknown>, requests: LlmRequest[] = []): LlmClient => ({
	call: async (request) => {
		requests.push(request);
		return { body: byTemplate[templateOf(request)] ?? NOTHING, model: request.model };
	},
});

// Each crop is its region, so a test can tell which was sent.
const cropRegion = async (_frame: Buffer, region: unknown): Promise<Buffer> =>
	Buffer.from(JSON.stringify(region));

const extract = (byTemplate: Record<string, unknown>, observedAt = 0) =>
	extractFrame(FRAME, observedAt, { client: seeing(byTemplate), cropRegion });

describe('extractFrame', () => {
	it("reads every template's region of the frame, each under the frame it came from", async () => {
		const requests: LlmRequest[] = [];
		await extractFrame(FRAME, 0, { client: seeing({}, requests), cropRegion });

		expect(requests.map(templateOf).sort()).toEqual(templateRegistry.map((spec) => spec.id).sort());
		requests.forEach((request) => {
			const spec = templateRegistry.find((candidate) => candidate.id === templateOf(request))!;
			expect(Buffer.from(request.image!.base64, 'base64').toString()).toBe(
				JSON.stringify(spec.captureRegion),
			);
			expect(request.model).toBe('gemini-3.8-flash');
			expect(request.toolChoice).toBe('report_crop');
		});
		expect(new Set(requests.map((request) => request.frameHash)).size).toBe(1);
		expect(requests[0]!.frameHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('reads with the model it is given', async () => {
		const requests: LlmRequest[] = [];
		await extractFrame(FRAME, 0, {
			client: seeing({}, requests),
			cropRegion,
			model: 'claude-sonnet-4-6',
		});
		expect(new Set(requests.map((request) => request.model))).toEqual(
			new Set(['claude-sonnet-4-6']),
		);
	});

	it("makes what a region shows that template's observation", async () => {
		const observations = await extract(
			{ fullscreen_results: read('TX | U.S. SENATE (R)', '95% IN', [PAXTON, CORNYN]) },
			1_700_000_000_000,
		);
		expect(observations).toEqual([
			{
				calledFor: ['Ken Paxton'],
				candidates: [
					{ key: 'Ken Paxton', name: 'Ken Paxton', party: 'R', pct: 63.8, votes: 885_949 },
					{ key: 'John Cornyn', name: 'John Cornyn', party: 'R', pct: 36.2, votes: 501_725 },
				],
				observedAt: 1_700_000_000_000,
				pctIn: 95,
				raceKey: 'TX U.S. SENATE (R)',
				reportedAt: null,
				source: 'air',
				templateId: 'fullscreen_results',
			},
		]);
	});

	it('returns one observation for each graphic on the frame, and none for an empty region', async () => {
		const observations = await extract({
			lower_third: read('AL-2 U.S. HOUSE', '76% IN', [PAXTON, CORNYN]),
			ticker_v1: read('VA | GOVERNOR', '84% IN', [PAXTON, CORNYN]),
		});
		expect(
			observations.map((observation) => [observation.templateId, observation.raceKey]).sort(),
		).toEqual([
			['lower_third', 'AL-2 U.S. HOUSE'],
			['ticker_v1', 'VA GOVERNOR'],
		]);
		expect(await extract({})).toEqual([]);
	});

	it('reads every ✓, so a race with two winners has both', async () => {
		const [observation] = await extract({
			ticker_v1: read('GA-11 U.S. HOUSE (R)', '90% IN', [PAXTON, { ...CORNYN, called: 'called' }]),
		});
		expect(observation!.calledFor).toEqual(['Ken Paxton', 'John Cornyn']);
	});

	it('leaves calledFor empty when no candidate has a ✓', async () => {
		const [observation] = await extract({
			ticker_v1: read('VA | GOVERNOR', '84% IN', [{ ...PAXTON, called: '' }, CORNYN]),
		});
		expect(observation!.calledFor).toEqual([]);
	});

	it('marks a ">95% IN" reporting figure as a floor, and only that', async () => {
		const [floor] = await extract({ ticker_v1: read('FL GOVERNOR', '>95% IN', [PAXTON, CORNYN]) });
		expect(floor).toMatchObject({ pctIn: 95, pctInIsMinimum: true });
		const [plain] = await extract({ ticker_v1: read('FL GOVERNOR', '84% IN', [PAXTON, CORNYN]) });
		expect(plain!.pctIn).toBe(84);
		expect(plain!.pctInIsMinimum).toBeUndefined();
		expect(plain!.missingFields).toBeUndefined();
	});

	it('keeps a graphic with no reporting badge and marks pct_in as missing', async () => {
		const [observation] = await extract({
			fullscreen_results: read('FL-22 U.S. HOUSE', '', [PAXTON, CORNYN]),
		});
		expect(observation).toMatchObject({ missingFields: ['pct_in'], pctIn: 0 });
	});

	it('takes the party letter off a name it bled into', async () => {
		const [observation] = await extract({
			ticker_v1: read('TX | ATTORNEY GENERAL (R)', '81% IN', [
				{ name: 'R MAYES MIDDLETON', party: 'R', pct: '55.2%', votes: '758,122' },
				{ name: 'CHIP ROY', party: 'R', pct: '44.8%', votes: '614,509' },
			]),
		});
		expect(observation!.candidates.map((candidate) => candidate.name)).toEqual([
			'MAYES MIDDLETON',
			'CHIP ROY',
		]);
	});

	describe('drops a read that is not a whole graphic', () => {
		const dropped = async (raceHeading: string, rows: Row[]): Promise<void> =>
			expect(await extract({ ticker_v1: read(raceHeading, '90% IN', rows) })).toEqual([]);

		// Caught mid-transition: surnames only, before the first names have come in.
		it('a candidate without a full name', () =>
			dropped('TX U.S. HOUSE (R) DISTRICT 9', [
				{ called: 'called', name: 'MEALER', party: 'R', pct: '68.3%', votes: '15,597' },
				{ name: 'CAIN', party: 'R', pct: '31.7%', votes: '7,245' },
			]));

		it('a placeholder for a name the model could not read', () =>
			dropped('VA | GOVERNOR', [PAXTON, { ...CORNYN, name: '<UNKNOWN> <UNKNOWN>' }]));

		it('a heading that is not a race', async () => {
			await dropped('DD26', [PAXTON, CORNYN]);
			await dropped('', [PAXTON, CORNYN]);
		});

		// The mid-flip signature: a field sliced through.
		it('a share with no votes, or votes with no share', async () => {
			await dropped('VA | GOVERNOR', [PAXTON, { ...CORNYN, votes: '' }]);
			await dropped('VA | GOVERNOR', [PAXTON, { ...CORNYN, pct: '' }]);
		});
	});

	it('keeps the other graphics on a frame where one is dropped', async () => {
		const observations = await extract({
			lower_third: read('AK U.S. SENATE', '44% IN', [PAXTON, CORNYN]),
			ticker_v1: read('VA | GOVERNOR', '84% IN', [PAXTON, { ...CORNYN, name: 'CORNYN' }]),
		});
		expect(observations.map((observation) => observation.templateId)).toEqual(['lower_third']);
	});

	it('fails the frame when a region cannot be read', async () => {
		const client: LlmClient = {
			call: async (request) => {
				if (templateOf(request) === 'lower_third') throw new Error('HTTP 503');
				return { body: read('VA | GOVERNOR', '84% IN', [PAXTON, CORNYN]), model: request.model };
			},
		};
		await expect(extractFrame(FRAME, 0, { client, cropRegion })).rejects.toThrow('HTTP 503');
	});

	it('fails the frame when a read is not what was asked for', async () => {
		const client: LlmClient = {
			call: async (request) => ({ body: { candidates: 'two' }, model: request.model }),
		};
		await expect(extractFrame(FRAME, 0, { client, cropRegion })).rejects.toThrow();
	});
});
