import type { Rect } from './types.js';

// Rects are normalized fractions of the frame ([0..1] for x/y/w/h). Multiply by
// the actual frame dimensions to get pixels — resolution-independent, so any 16:9
// capture (1080p, 4K, …) maps correctly with no hardcoded reference size.
export const scaleRectToFrame = (
	rect: Rect,
	frameWidth: number,
	frameHeight: number,
): { h: number; w: number; x: number; y: number } => ({
	h: Math.round(rect.h * frameHeight),
	w: Math.round(rect.w * frameWidth),
	x: Math.round(rect.x * frameWidth),
	y: Math.round(rect.y * frameHeight),
});
