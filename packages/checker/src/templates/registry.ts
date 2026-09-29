import type { TemplateSpec } from './types.js';

import fullscreenResults from './fullscreenResults.js';
import lowerThird from './lowerThird.js';
import tickerV1 from './tickerV1.js';

// Every on-air template, each read from its own region of every frame.
export const templateRegistry: readonly TemplateSpec[] = [tickerV1, fullscreenResults, lowerThird];

export const findTemplate = (id: string): TemplateSpec | undefined =>
	templateRegistry.find((spec) => spec.id === id);
