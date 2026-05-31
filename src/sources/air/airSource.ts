import { createHash } from 'node:crypto';

import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { Recorder } from '../../replay/recorder.js';
import { extractFrame } from '../../vision/extractFrame.js';
import { makeAnthropicLlmClient } from '../../vision/anthropicClient.js';
import type { LlmClient } from '../../vision/llmClient.js';
import { makeBrowserCapturer } from './browserCapturer.js';
import type { BrowserCapturer } from './browserCapturer.js';

// The air source: grab a frame of the on-air broadcast, run extractFrame, hand the
// resulting observations on, and record the frame for replay / the web view. One
// captureOnce() is what the scheduler (interval or manual button) drives.
//   AIR_BROWSER_URL   CDP endpoint of the debug Chrome (default http://localhost:9222)
//   AIR_URL_MATCH     substring the target tab URL must contain (default 'directv')

export type AirSourceConfig = {
  capturer?: BrowserCapturer; // injectable for tests; default attaches via CDP
  llmClient?: LlmClient; // injectable; default real Anthropic client
  onObservations: (observations: RaceObservation[]) => void;
  recorder?: Recorder; // records each frame (content-addressed) for replay/web view
};

// The last frame plus what the VLM read from it — the web view's frame panel shows
// the PNG (via /api/last-frame) alongside these observations ("what it read").
export type LastFrame = {
  hash: string;
  observations: RaceObservation[];
  png: Buffer;
  ts: number;
};

export type AirSource = {
  captureOnce: () => Promise<void>;
  close: () => Promise<void>;
  getLastFrame: () => LastFrame | undefined;
};

export const makeAirSource = (config: AirSourceConfig): AirSource => {
  const capturer =
    config.capturer ??
    makeBrowserCapturer({
      browserURL: process.env.AIR_BROWSER_URL ?? 'http://localhost:9222',
      urlMatch: process.env.AIR_URL_MATCH ?? 'directv',
    });
  const llmClient = config.llmClient ?? makeAnthropicLlmClient();
  let lastFrame: LastFrame | undefined;

  return {
    captureOnce: async () => {
      const png = await capturer.captureOnce();
      const ts = Date.now();
      const hash = createHash('sha256').update(png).digest('hex');
      config.recorder?.recordFrame({ png, ts });
      const observations = await extractFrame(png, ts, { client: llmClient });
      lastFrame = { hash, observations, png, ts };
      config.onObservations(observations);
    },
    close: () => capturer.close(),
    getLastFrame: () => lastFrame,
  };
};
