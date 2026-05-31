import { describe, expect, it } from 'vitest';

import { extractFrame } from '../../src/vision/extractFrame.js';
import type { LlmClient } from '../../src/vision/llmClient.js';

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

    const observations = await extractFrame(FRAME, 1_700_000_000_000, { client, ...DEPS_NO_RECALL });
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

  it('returns one observation per detected template and ignores unknown ids', async () => {
    const client = clientReturning({
      templates: [
        { candidates: [], singletons: { race_heading: 'GA-13 U.S. HOUSE (D)' }, templateId: 'side_slab' },
        { candidates: [], singletons: {}, templateId: 'not_a_real_template' },
      ],
    });
    const observations = await extractFrame(FRAME, 0, { client, ...DEPS_NO_RECALL });
    expect(observations).toHaveLength(1);
    expect(observations[0]!.templateId).toBe('side_slab');
  });

  it('returns an empty array when no templates are present', async () => {
    const observations = await extractFrame(FRAME, 0, { client: clientReturning({ templates: [] }) });
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
  const RECROP_DEPS = { recallPass: true as const, recropRegion: async () => Buffer.from('fake-crop') };

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
    expect(observations[0]!.candidates).toHaveLength(3); // crop's full list wins
  });

  it('re-crop pass clears a pass-1 false-positive call when the crop sees no ✓', async () => {
    const client = twoPassClient(
      {
        templates: [
          {
            candidates: [{ called: 'called', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' }],
            singletons: { pct_in: '0', race_heading: 'X' },
            templateId: 'ticker_v1',
          },
        ],
      },
      { candidates: [{ called: '', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' }], pctIn: '0' },
    );
    const observations = await extractFrame(FRAME, 0, { client, ...RECROP_DEPS });
    expect(observations[0]!.calledFor).toEqual([]);
  });
});
