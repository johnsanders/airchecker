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

  it('re-call pass overrides calledFor from the upscaled crop', async () => {
    // Pass 1 misses the check mark (called: ''); the recall pass reads the crop
    // and names Paxton — the final calledFor should be corrected to his key.
    const client: LlmClient = {
      call: async (request) => {
        if (request.tool?.name === 'report_call')
          return { body: { calledCandidateNames: ['Ken Paxton'] }, model: 'claude-haiku-4-5' };
        return {
          body: {
            templates: [
              {
                candidates: [
                  { called: '', name: 'Ken Paxton', party: 'R', pct: '63.8', votes: '885,949' },
                  { called: '', name: 'John Cornyn', party: 'R', pct: '36.2', votes: '501,725' },
                ],
                singletons: { pct_in: '95', race_heading: 'TX U.S. SENATE (R)' },
                templateId: 'ticker_v1',
              },
            ],
          },
          model: 'claude-haiku-4-5',
        };
      },
    };
    const observations = await extractFrame(FRAME, 0, {
      client,
      recallPass: true,
      recropRegion: async () => Buffer.from('fake-crop'),
    });
    expect(observations[0]!.calledFor).toEqual(['Ken Paxton']);
  });

  it('re-call pass captures TWO winners in a top-two race', async () => {
    // GA-11 top-two: both Cowan and Adkerson have check marks. Pass 1 sees only
    // Cowan; the recall pass must surface both.
    const client: LlmClient = {
      call: async (request) => {
        if (request.tool?.name === 'report_call')
          return {
            body: { calledCandidateNames: ['John Cowan', 'Robert Adkerson'] },
            model: 'claude-haiku-4-5',
          };
        return {
          body: {
            templates: [
              {
                candidates: [
                  { called: 'called', name: 'John Cowan', party: 'R', pct: '42.6', votes: '34,141' },
                  { called: '', name: 'Robert Adkerson', party: 'R', pct: '21.7', votes: '17,399' },
                  { called: '', name: 'Tricia Pridemore', party: 'R', pct: '19.0', votes: '15,194' },
                ],
                singletons: { pct_in: '90', race_heading: 'GA-11 U.S. HOUSE (R)' },
                templateId: 'fullscreen_results',
              },
            ],
          },
          model: 'claude-haiku-4-5',
        };
      },
    };
    const observations = await extractFrame(FRAME, 0, {
      client,
      recallPass: true,
      recropRegion: async () => Buffer.from('fake-crop'),
    });
    expect(observations[0]!.calledFor).toEqual(['John Cowan', 'Robert Adkerson']);
  });

  it('re-call pass clears a pass-1 false-positive call when the crop sees no check mark', async () => {
    const client: LlmClient = {
      call: async (request) => {
        if (request.tool?.name === 'report_call')
          return { body: { calledCandidateNames: [] }, model: 'claude-haiku-4-5' };
        return {
          body: {
            templates: [
              {
                candidates: [{ called: 'called', name: 'Jane Smith', party: 'D', pct: '50.0', votes: '100' }],
                singletons: { pct_in: '0', race_heading: 'X' },
                templateId: 'ticker_v1',
              },
            ],
          },
          model: 'claude-haiku-4-5',
        };
      },
    };
    const observations = await extractFrame(FRAME, 0, {
      client,
      recallPass: true,
      recropRegion: async () => Buffer.from('fake-crop'),
    });
    expect(observations[0]!.calledFor).toEqual([]);
  });
});
