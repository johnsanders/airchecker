import sharp from 'sharp';

import type { Rect } from '../templates/types.js';

import { scaleRectToFrame } from '../templates/geometry.js';

// Crops a frame to a template's captureRegion and sizes the crop for the API. The
// on-air "called" check mark is a tiny gold glyph the model misses ~40% of the
// time on a full frame but reads 20/20 from the region crop (measured) — the win
// is isolation (the model's attention and visual tokens go to the graphic alone),
// not magnification.
//
// Sizing follows Anthropic's standard resolution tier, which the crops were first read
// on and Gemini reads as well: the API downsizes anything over a 1568 px long edge or 1568 visual
// tokens (28×28 patches) before the model sees it. Sending more pixels than that
// only bloats the upload — a 3× upscale of a wide region blew the 10 MB image limit
// on photo-heavy frames — so the crop is scaled to fit those limits exactly and
// never enlarged past MAX_UPSCALE.
const MAX_UPSCALE = 3;
const MAX_LONG_EDGE_PX = 1568;
const MAX_VISUAL_TOKENS = 1568;
const PATCH_PX = 28;

export const fitScale = (width: number, height: number, maxUpscale: number = MAX_UPSCALE): number =>
	Math.min(
		maxUpscale,
		MAX_LONG_EDGE_PX / Math.max(width, height),
		Math.sqrt((MAX_VISUAL_TOKENS * PATCH_PX * PATCH_PX) / (width * height)),
	);

export const cropAndUpscaleRegion = async (
	framePng: Buffer,
	region: Rect,
	maxUpscale: number = MAX_UPSCALE,
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

	const targetWidth = Math.round(width * fitScale(width, height, maxUpscale));
	return sharp(framePng)
		.extract({ height, left, top, width })
		.resize({ width: targetWidth })
		.png()
		.toBuffer();
};
