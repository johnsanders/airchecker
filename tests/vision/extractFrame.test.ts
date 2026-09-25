import { describe, expect, it } from 'vitest';

import type { LlmClient } from '../../src/vision/llmClient.js';

import { extractFrame } from '../../src/vision/extractFrame.js';

const clientReturning = (body: unknown): LlmClient => ({
	call: async () => ({ body, model: 'claude-haiku-4-5' }),
});

const FRAME = Buffer.from('fake-png-bytes');

// These tests exercise pass-1 mapping in isolation with a single-response fake,
// so the re-call second pass is disabled.
const DEPS_NO_RECALL = { recallPass: false as const };

describe('extractFrame', () => {
	it('maps a detected fullscreen template to an air RaceObservation', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: 'called', name: 'Ken Paxton', party: 'R', pct: '63.8', votes: '885,949' },
						{ called: '', name: 'John Cornyn', party: 'R', pct: '36.2', votes: '501,725' },
					],
					singletons: { pct_in: '95', race_heading: 'TX U.S. SENATE (R)' },
					templateId: 'fullscreen_results',
				},
			],
		});

		const observations = await extractFrame(FRAME, 1_700_000_000_000, {
			client,
			...DEPS_NO_RECALL,
		});
		expect(observations).toHaveLength(1);
		const observation = observations[0]!;
		expect(observation.source).toBe('air');
		expect(observation.templateId).toBe('fullscreen_results');
		expect(observation.observedAt).toBe(1_700_000_000_000);
		expect(observation.raceKey).toBe('TX U.S. SENATE (R)');
		expect(observation.pctIn).toBe(95);
		expect(observation.calledFor).toEqual(['Ken Paxton']);
		expect(observation.candidates).toHaveLength(2);

		const paxton = observation.candidates[0]!;
		expect(paxton.name).toBe('Ken Paxton');
		expect(paxton.party).toBe('R');
		expect(paxton.votes).toBe(885949);
		expect(paxton.pct).toBeCloseTo(63.8, 4);
	});

	it('drops a race as a missed capture when a candidate lacks a full name', async () => {
		// Frame caught mid-transition: the ticker shows surnames only, before the first
		// names have scrolled in. A partial roster can't reconcile — emit nothing.
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: 'called', name: 'MEALER', party: 'R', pct: '68.3', votes: '15,597' },
						{ called: '', name: 'CAIN', party: 'R', pct: '31.7', votes: '7,245' },
					],
					singletons: { pct_in: '90', race_heading: 'TX U.S. HOUSE (R) DISTRICT 9' },
					templateId: 'ticker_v1',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations).toHaveLength(0);
	});

	it('keeps a race when every candidate has a full first and last name', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: 'called', name: 'Alex Mealer', party: 'R', pct: '68.3', votes: '15,597' },
						{ called: '', name: 'Briscoe Cain', party: 'R', pct: '31.7', votes: '7,245' },
					],
					singletons: { pct_in: '90', race_heading: 'TX U.S. HOUSE (R) DISTRICT 9' },
					templateId: 'ticker_v1',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations).toHaveLength(1);
		expect(observations[0]!.candidates).toHaveLength(2);
	});

	it('returns one observation per detected template and ignores unknown ids', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [],
					singletons: { race_heading: 'GA-13 U.S. HOUSE (D)' },
					templateId: 'lower_third',
				},
				{ candidates: [], singletons: {}, templateId: 'not_a_real_template' },
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations).toHaveLength(1);
		expect(observations[0]!.templateId).toBe('lower_third');
	});

	it('marks a ">95% IN" reporting figure as a floor', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{
							called: 'called',
							name: 'Abigail Spanberger',
							party: 'D',
							pct: '57.7%',
							votes: '1,976,857',
						},
						{
							called: '',
							name: 'Winsome Earle-Sears',
							party: 'R',
							pct: '42.3%',
							votes: '1,449,586',
						},
					],
					singletons: { pct_in: '>95% IN', race_heading: 'VA | GOVERNOR' },
					templateId: 'ticker_v1',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations[0]!.pctIn).toBe(95);
		expect(observations[0]!.pctInIsMinimum).toBe(true);
	});

	it('leaves pctInIsMinimum unset for a plain reporting figure', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: '', name: 'Luke Bronin', party: 'D', pct: '54.3%', votes: '29,658' },
						{ called: '', name: 'John Larson', party: 'D', pct: '32.8%', votes: '17,933' },
					],
					singletons: { pct_in: '84% IN', race_heading: 'CT | U.S. HOUSE (D) DISTRICT 1' },
					templateId: 'ticker_v1',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations[0]!.pctIn).toBe(84);
		expect(observations[0]!.pctInIsMinimum).toBeUndefined();
	});

	it('keeps a graphic with no reporting badge and marks pct_in as missing', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: '', name: 'Pia Dandiya', party: 'D', pct: '32.0%', votes: '373632' },
						{ called: '', name: 'Casey Askar', party: 'R', pct: '66.0%', votes: '827282' },
					],
					singletons: { pct_in: '', race_heading: 'FL-22 U.S. HOUSE' },
					templateId: 'fullscreen_results',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations).toHaveLength(1);
		expect(observations[0]!.pctIn).toBe(0);
		expect(observations[0]!.missingFields).toEqual(['pct_in']);
	});

	it('drops a graphic whose race heading came back empty', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [
						{ called: '', name: 'Pia Dandiya', party: 'D', pct: '32.0%', votes: '373632' },
						{ called: '', name: 'Casey Askar', party: 'R', pct: '66.0%', votes: '827282' },
					],
					singletons: { pct_in: '68% IN', race_heading: '' },
					templateId: 'fullscreen_results',
				},
			],
		});
		expect(await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL })).toEqual([]);
	});

	it('returns an empty array when no templates are present', async () => {
		const observations = await extractFrame(FRAME, 0, {
			client: clientReturning({ templates: [] }),
		});
		expect(observations).toEqual([]);
	});

	it('leaves calledFor empty when no candidate is marked called', async () => {
		const client = clientReturning({
			templates: [
				{
					candidates: [{ called: '', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' }],
					singletons: { pct_in: '0', race_heading: 'X' },
					templateId: 'ticker_v1',
				},
			],
		});
		const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
		expect(observations[0]!.calledFor).toEqual([]);
	});

	// Two-call fake: pass-1 'report_templates' returns `pass1`; pass-2 'report_crop'
	// returns `crop`. Lets each test script both reads independently.
	const twoPassClient = (pass1: unknown, crop: unknown): LlmClient => ({
		call: async (request) => ({
			body: request.tool?.name === 'report_crop' ? crop : pass1,
			model: 'claude-haiku-4-5',
		}),
	});
	const RECROP_DEPS = {
		recallPass: true as const,
		recropRegion: async () => Buffer.from('fake-crop'),
	};

	it('re-crop pass overrides votes/pct/call from the upscaled crop', async () => {
		// Pass 1 misreads Cornyn's votes (459,009) and misses Paxton's ✓; the crop read
		// corrects the digits AND the call.
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ called: '', name: 'Ken Paxton', party: 'R', pct: '64.1', votes: '819,681' },
							{ called: '', name: 'John Cornyn', party: 'R', pct: '35.9', votes: '459,009' },
						],
						singletons: { pct_in: '94', race_heading: 'TX U.S. SENATE (R)' },
						templateId: 'ticker_v1',
					},
				],
			},
			{
				candidates: [
					{ called: 'called', name: 'Ken Paxton', party: 'R', pct: '64.1', votes: '819,681' },
					{ called: '', name: 'John Cornyn', party: 'R', pct: '35.9', votes: '459,609' },
				],
				pctIn: '94',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		const o = observations[0]!;
		expect(o.calledFor).toEqual(['Ken Paxton']);
		const cornyn = o.candidates.find((c) => c.name === 'John Cornyn')!;
		expect(cornyn.votes).toBe(459609); // crop digit wins over pass-1's 459,009
	});

	it('re-crop pass captures TWO winners in a top-two race', async () => {
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ called: 'called', name: 'John Cowan', party: 'R', pct: '42.6', votes: '34,141' },
							{ called: '', name: 'Robert Adkerson', party: 'R', pct: '21.7', votes: '17,399' },
						],
						singletons: { pct_in: '90', race_heading: 'GA-11 U.S. HOUSE (R)' },
						templateId: 'fullscreen_results',
					},
				],
			},
			{
				candidates: [
					{ called: 'called', name: 'John Cowan', party: 'R', pct: '42.6', votes: '34,141' },
					{ called: 'called', name: 'Robert Adkerson', party: 'R', pct: '21.7', votes: '17,399' },
					{ called: '', name: 'Tricia Pridemore', party: 'R', pct: '19.0', votes: '15,194' },
				],
				pctIn: '90',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		expect(observations[0]!.calledFor).toEqual(['John Cowan', 'Robert Adkerson']);
		expect(observations[0]!.candidates).toHaveLength(2); // pass-1 roster is authoritative
	});

	it('keeps pass-1 names when the crop returns only first names, taking its numbers and ✓', async () => {
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ called: '', name: 'James Talarico', party: 'D', pct: '52.4%', votes: '1,216,412' },
							{
								called: '',
								name: 'Jasmine Crockett',
								party: 'D',
								pct: '46.2%',
								votes: '1,071,900',
							},
						],
						singletons: { pct_in: '>95% IN', race_heading: 'TX | U.S. SENATE (D)' },
						templateId: 'ticker_v1',
					},
				],
			},
			{
				candidates: [
					{ called: 'called', name: 'James', party: 'D', pct: '52.4%', votes: '1,216,412' },
					{ called: '', name: 'Jasmine', party: 'D', pct: '46.2%', votes: '1,071,908' },
				],
				pctIn: '>95%',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		expect(observations).toHaveLength(1);
		const o = observations[0]!;
		expect(o.candidates.map((c) => c.name)).toEqual(['James Talarico', 'Jasmine Crockett']);
		expect(o.calledFor).toEqual(['James Talarico']);
		expect(o.candidates[1]!.votes).toBe(1071908); // crop digits win
		expect(o.pctIn).toBe(95);
		expect(o.pctInIsMinimum).toBe(true);
	});

	it('corrects swapped pass-1 labels by matching each roster to the region that shows it', async () => {
		// Pass 1 filed the Arizona lower-third as the ticker and the Virginia ticker as
		// the lower-third. The region reads (keyed by captureRegion) show the truth.
		const azRow = [
			{ called: '', name: 'Amish', party: 'D', pct: '30.0%', votes: '2368978' },
			{ called: '', name: 'Jay', party: 'R', pct: '70.0%', votes: '493809' },
		];
		const vaRow = [
			{ called: 'called', name: 'Abigail', party: 'D', pct: '57.7%', votes: '1,976,857' },
			{ called: '', name: 'Winsome', party: 'R', pct: '42.3%', votes: '1,449,586' },
		];
		let cropCalls = 0;
		const client: LlmClient = {
			call: async (request) => {
				if (request.tool?.name !== 'report_crop')
					return {
						body: {
							templates: [
								{
									candidates: [
										{ name: 'Amish Shah', party: 'D', pct: '30.0%', votes: '2368978' },
										{ name: 'Jay Feely', party: 'R', pct: '70.0%', votes: '493809' },
									],
									singletons: { pct_in: '45 IN', race_heading: 'AZ | U.S. HOUSE' },
									templateId: 'ticker_v1',
								},
								{
									candidates: [
										{ name: 'Abigail Spanberger', party: 'D', pct: '57.7%', votes: '1976857' },
										{ name: 'Winsome Earle-Sears', party: 'R', pct: '42.3%', votes: '1449586' },
									],
									singletons: { pct_in: '>95% IN', race_heading: 'VA | GOVERNOR' },
									templateId: 'lower_third',
								},
							],
						},
						model: 'claude-haiku-4-5',
					};
				cropCalls += 1;
				const region = Buffer.from(request.image!.base64, 'base64').toString();
				const body =
					region === 'region:ticker_v1'
						? { candidates: vaRow, pctIn: '>95% IN' }
						: region === 'region:lower_third'
							? { candidates: azRow, pctIn: '45% IN' }
							: { candidates: [], pctIn: '' };
				return { body, model: 'claude-sonnet-4-6' };
			},
		};
		// The stub crop encodes which template's region was requested.
		const recropRegion = async (_png: Buffer, region: { y: number }): Promise<Buffer> =>
			Buffer.from(
				region.y > 0.8
					? 'region:ticker_v1'
					: region.y > 0.5
						? 'region:lower_third'
						: 'region:fullscreen',
			);

		const observations = await extractFrame(FRAME, 0, { client, recallPass: true, recropRegion });
		expect(observations.map((o) => o.templateId).sort()).toEqual(['lower_third', 'ticker_v1']);
		const az = observations.find((o) => o.templateId === 'lower_third')!;
		expect(az.raceKey).toBe('AZ U.S. HOUSE');
		expect(az.candidates.map((c) => c.name)).toEqual(['Amish Shah', 'Jay Feely']);
		expect(az.pctIn).toBe(45);
		const va = observations.find((o) => o.templateId === 'ticker_v1')!;
		expect(va.raceKey).toBe('VA GOVERNOR');
		expect(va.calledFor).toEqual(['Abigail Spanberger']);
		expect(va.pctInIsMinimum).toBe(true);
		expect(cropCalls).toBe(2); // both regions already read once; no extra calls to recover
	});

	it('keys the race from the crop heading when the crop read one', async () => {
		// Pass 1 folded the badge into the heading as a phantom district; the zoomed crop
		// reads the heading cleanly and wins.
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ name: 'Amish Shah', party: 'D', pct: '30.0%', votes: '2368978' },
							{ name: 'Jay Feely', party: 'R', pct: '70.0%', votes: '493809' },
						],
						singletons: { pct_in: '45 IN', race_heading: 'AZ | U.S. HOUSE DISTRICT 45' },
						templateId: 'lower_third',
					},
				],
			},
			{
				candidates: [
					{ called: '', name: 'Amish Shah', party: 'D', pct: '30.0%', votes: '2368978' },
					{ called: '', name: 'Jay Feely', party: 'R', pct: '70.0%', votes: '493809' },
				],
				pctIn: '45% IN',
				raceHeading: 'AZ U.S. HOUSE',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		expect(observations[0]!.raceKey).toBe('AZ U.S. HOUSE');
		expect(observations[0]!.extractedFields?.race_heading).toBe('AZ U.S. HOUSE');
	});

	it('drops an item whose only recovery read failed, but keeps the rest of the frame', async () => {
		// Pass 1 filed Arizona under fullscreen; the fullscreen crop is empty, the ticker
		// crop (already read for the VA item) doesn't match, and the lower-third crop
		// read throws. The VA ticker still lands; Arizona is dropped, not fatal.
		const client: LlmClient = {
			call: async (request) => {
				if (request.tool?.name !== 'report_crop')
					return {
						body: {
							templates: [
								{
									candidates: [
										{ name: 'Amish Shah', party: 'D', pct: '30.0%', votes: '2368978' },
										{ name: 'Jay Feely', party: 'R', pct: '70.0%', votes: '493809' },
									],
									singletons: { pct_in: '45% IN', race_heading: 'AZ U.S. HOUSE' },
									templateId: 'fullscreen_results',
								},
								{
									candidates: [
										{ name: 'Abigail Spanberger', party: 'D', pct: '57.7%', votes: '1976857' },
										{ name: 'Winsome Earle-Sears', party: 'R', pct: '42.3%', votes: '1449586' },
									],
									singletons: { pct_in: '>95% IN', race_heading: 'VA GOVERNOR' },
									templateId: 'ticker_v1',
								},
							],
						},
						model: 'claude-haiku-4-5',
					};
				const region = Buffer.from(request.image!.base64, 'base64').toString();
				if (region === 'region:lower_third') throw new Error('400 image exceeds 10 MB maximum');
				const body =
					region === 'region:ticker_v1'
						? {
								candidates: [
									{ called: '', name: 'Abigail', party: 'D', pct: '57.7%', votes: '1,976,857' },
									{ called: '', name: 'Winsome', party: 'R', pct: '42.3%', votes: '1,449,586' },
								],
								pctIn: '>95% IN',
								raceHeading: 'VA | GOVERNOR',
							}
						: { candidates: [], pctIn: '', raceHeading: '' };
				return { body, model: 'claude-sonnet-4-6' };
			},
		};
		const recropRegion = async (_png: Buffer, region: { y: number }): Promise<Buffer> =>
			Buffer.from(
				region.y > 0.8
					? 'region:ticker_v1'
					: region.y > 0.5
						? 'region:lower_third'
						: 'region:fullscreen',
			);
		const observations = await extractFrame(FRAME, 0, { client, recallPass: true, recropRegion });
		expect(observations.map((o) => o.raceKey)).toEqual(['VA GOVERNOR']);
	});

	it('rejects the frame when no region could be read at all', async () => {
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ name: 'Abigail Spanberger', party: 'D', pct: '57.7%', votes: '1976857' },
							{ name: 'Winsome Earle-Sears', party: 'R', pct: '42.3%', votes: '1449586' },
						],
						singletons: { pct_in: '>95% IN', race_heading: 'VA GOVERNOR' },
						templateId: 'ticker_v1',
					},
				],
			},
			undefined,
		);
		const failing: LlmClient = {
			call: async (request) => {
				if (request.tool?.name === 'report_crop') throw new Error('529 overloaded');
				return client.call(request);
			},
		};
		await expect(extractFrame(FRAME, 0, { client: failing, ...RECROP_DEPS })).rejects.toThrow(
			'529 overloaded',
		);
	});

	it('drops an observation whose crop read shares no candidate with pass 1', async () => {
		// Pass 1 filed a lower-third roster under ticker_v1; the ticker crop shows a
		// different race entirely, so nothing read from it belongs to this roster.
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ called: '', name: 'Mary Peltola', party: 'D', pct: '87.0%', votes: '448293' },
							{ called: '', name: 'Dan Sullivan', party: 'R', pct: '13.0%', votes: '22453' },
						],
						singletons: { pct_in: '43% IN', race_heading: 'AK U.S. SENATE' },
						templateId: 'ticker_v1',
					},
				],
			},
			{
				candidates: [
					{ called: 'called', name: 'Ken Paxton', party: 'R', pct: '63.8%', votes: '885,949' },
					{ called: '', name: 'John Cornyn', party: 'R', pct: '36.2%', votes: '501,725' },
				],
				pctIn: '>95%',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		expect(observations).toEqual([]);
	});

	it('re-crop pass clears a pass-1 false-positive call when the crop sees no ✓', async () => {
		const client = twoPassClient(
			{
				templates: [
					{
						candidates: [
							{ called: 'called', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' },
						],
						singletons: { pct_in: '0', race_heading: 'X' },
						templateId: 'ticker_v1',
					},
				],
			},
			{
				candidates: [{ called: '', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' }],
				pctIn: '0',
			},
		);
		const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
		expect(observations[0]!.calledFor).toEqual([]);
	});
});
