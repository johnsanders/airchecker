import sharp from 'sharp';

import { scaleRectToFrame } from '../templates/geometry.js';
import type { Rect } from '../templates/types.js';

// Crops a frame to a template's captureRegion and upscales it. The on-air "called"
// check mark is a tiny gold glyph that the model misses ~40% of the time on a full
// frame but reads 20/20 on an upscaled crop (measured) — this is what makes the
// re-call pass reliable.
//
// Upscale aims for DEFAULT_UPSCALE× but is CAPPED so the encoded PNG can't exceed
// the API's 10 MB image limit. A small region (ticker/slab/lower-third) gets the
// full 3×; a full-frame region (fullscreen_results' captureRegion is the whole
// canvas) would 3× to ~5760px and blow the cap, so it's clamped down. Without the
// cap, fullscreen frames 400 ("image exceeds 10 MB maximum").
const DEFAULT_UPSCALE = 3;
const MAX_UPSCALED_WIDTH = 4000;

export const cropAndUpscaleRegion = async (
  framePng: Buffer,
  region: Rect,
  upscale: number = DEFAULT_UPSCALE,
): Promise<Buffer> => {
  // Decode to get true pixel dimensions — metadata() is unreliable on some PNGs.
  const decoded = await sharp(framePng).raw().toBuffer({ resolveWithObject: true });
  const frameWidth = decoded.info.width;
  const frameHeight = decoded.info.height;

  const px = scaleRectToFrame(region, frameWidth, frameHeight);
  const left = Math.max(0, px.x);
  const top = Math.max(0, px.y);
  const width = Math.min(frameWidth - left, px.w);
  const height = Math.min(frameHeight - top, px.h);

  const targetWidth = Math.min(Math.round(width * upscale), MAX_UPSCALED_WIDTH);
  return sharp(framePng)
    .extract({ height, left, top, width })
    .resize({ width: targetWidth })
    .png()
    .toBuffer();
};
