import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeSourceErrors } from '../../src/runtime/sourceErrors.js';
import { errorMessage } from '../../src/sources/http.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('source errors', () => {
	it('logs a failure once, counts repeats quietly, and logs the recovery', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const recovered = vi.spyOn(console, 'log').mockImplementation(() => {});
		let clock = 1_000;
		let changes = 0;
		const errors = makeSourceErrors({ now: () => clock, onChange: () => (changes += 1) });

		errors.fail('air', new Error('no open tab'));
		clock = 6_000;
		errors.fail('air', new Error('no open tab'));
		errors.fail('air', new Error('no open tab'));
		expect(errors.get('air')).toEqual({ count: 3, message: 'no open tab', since: 1_000 });
		expect(logged).toHaveBeenCalledTimes(1);
		expect(logged).toHaveBeenCalledWith('[air] failing: no open tab');

		errors.ok('air');
		expect(errors.get('air')).toBeUndefined();
		expect(recovered).toHaveBeenCalledWith('[air] recovered after 3 failed attempt(s)');
		expect(changes).toBe(2);
	});

	it('logs again when the message changes, keeping when the failure started', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		let clock = 1_000;
		const errors = makeSourceErrors({ now: () => clock });
		errors.fail('Ross', new Error('timeout'));
		clock = 2_000;
		errors.fail('Ross', new Error('HTTP 503'));
		expect(logged).toHaveBeenCalledTimes(2);
		expect(errors.get('Ross')).toEqual({ count: 2, message: 'HTTP 503', since: 1_000 });
	});

	it('remembers when each source last answered', () => {
		let clock = 1_000;
		const errors = makeSourceErrors({ now: () => clock });
		expect(errors.lastOk('Ross')).toBeUndefined();
		errors.ok('Ross');
		clock = 6_000;
		vi.spyOn(console, 'error').mockImplementation(() => {});
		errors.fail('Ross', new Error('timeout'));
		expect(errors.lastOk('Ross')).toBe(1_000);
		expect(errors.lastOk('DDHQ')).toBeUndefined();
	});

	it('ok on a healthy source is silent', () => {
		const recovered = vi.spyOn(console, 'log').mockImplementation(() => {});
		makeSourceErrors().ok('DDHQ');
		expect(recovered).not.toHaveBeenCalled();
	});

	it('includes the cause chain, where fetch keeps the real reason', () => {
		const error = new Error('fetch failed', {
			cause: new Error('connect ECONNREFUSED 127.0.0.1:443'),
		});
		expect(errorMessage(error)).toBe('fetch failed (connect ECONNREFUSED 127.0.0.1:443)');
		expect(errorMessage('plain')).toBe('plain');
	});
});
