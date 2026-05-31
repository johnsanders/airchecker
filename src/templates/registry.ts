import type { TemplateSpec } from './types.js';

import fullscreenResults from './fullscreenResults.js';
import lowerThird from './lowerThird.js';
import sideSlab from './sideSlab.js';
import tickerV1 from './tickerV1.js';

// Every on-air template detect/extract iterate over. One spec per surface variant.
export const templateRegistry: readonly TemplateSpec[] = [
	tickerV1,
	fullscreenResults,
	sideSlab,
	lowerThird,
];

export const findTemplate = (id: string): TemplateSpec | undefined =>
	templateRegistry.find((spec) => spec.id === id);
