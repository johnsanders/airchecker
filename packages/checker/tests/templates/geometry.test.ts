import { describe, expect, it } from 'vitest';

import { scaleRectToFrame } from '../../src/templates/geometry.js';

describe('scaleRectToFrame', () => {
	it('maps a full-frame fraction to the whole frame at any size', () => {
		expect(scaleRectToFrame({ h: 1, w: 1, x: 0, y: 0 }, 3840, 2160)).toEqual({
			h: 2160,
			w: 3840,
			x: 0,
			y: 0,
		});
	});

	it('maps a bottom-strip fraction to 1080p pixels', () => {
		expect(scaleRectToFrame({ h: 0.06, w: 0.6, x: 0.2, y: 0.9 }, 1920, 1080)).toEqual({
			h: 65,
			w: 1152,
			x: 384,
			y: 972,
		});
	});

	it('gives 2× the pixels on a 4K frame (resolution-independent)', () => {
		expect(scaleRectToFrame({ h: 0.06, w: 0.6, x: 0.2, y: 0.9 }, 3840, 2160)).toEqual({
			h: 130,
			w: 2304,
			x: 768,
			y: 1944,
		});
	});
});
