import { describe, expect, it } from 'vitest';

import type { ChangeMessage } from '../../src/web/changeBus.js';

import { makeChangeBus } from '../../src/web/changeBus.js';

describe('changeBus', () => {
	it('delivers a broadcast to a subscriber', () => {
		const bus = makeChangeBus();
		const received: ChangeMessage[] = [];
		bus.subscribe((message) => received.push(message));
		bus.broadcast({ raceKeys: ['2024-TX-US_House-34-NP-General'], type: 'changed' });
		expect(received).toEqual([{ raceKeys: ['2024-TX-US_House-34-NP-General'], type: 'changed' }]);
	});

	it('fans out to every subscriber independently', () => {
		const bus = makeChangeBus();
		const a: ChangeMessage[] = [];
		const b: ChangeMessage[] = [];
		bus.subscribe((message) => a.push(message));
		bus.subscribe((message) => b.push(message));
		bus.broadcast({ type: 'changed' });
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	it('stops delivering after unsubscribe', () => {
		const bus = makeChangeBus();
		const received: ChangeMessage[] = [];
		const off = bus.subscribe((message) => received.push(message));
		bus.broadcast({ type: 'changed' });
		off();
		bus.broadcast({ type: 'changed' });
		expect(received).toHaveLength(1);
	});
});
