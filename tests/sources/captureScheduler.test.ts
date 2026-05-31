import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCaptureScheduler } from '../../src/sources/air/captureScheduler.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A capture thunk that completes after `durationMs` of fake time, counting calls.
const makeCapture = (durationMs: number) => {
  let calls = 0;
  const captureOnce = (): Promise<void> => {
    calls += 1;
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  };
  return { captureOnce, calls: () => calls };
};

describe('captureScheduler — interval mode', () => {
  it('fires once per interval', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capture.calls()).toBe(3);
    scheduler.stop();
  });

  it('defaults to a 5000ms interval', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({ captureOnce: capture.captureOnce, mode: 'interval' });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(capture.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(capture.calls()).toBe(1);
    scheduler.stop();
  });

  it('SKIPS a tick that fires while a capture is still in flight', async () => {
    // Capture takes 8s; interval is 5s → the tick at 10s lands mid-capture and is dropped.
    const capture = makeCapture(8000);
    const skips: number[] = [];
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
      onSkip: () => skips.push(1),
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000); // tick 1 fires, runs 5000–13000
    expect(capture.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); // tick 2 at 10000: still busy → skipped
    expect(capture.calls()).toBe(1);
    expect(skips).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000); // 15000: capture 1 done at 13000, tick 3 fires
    expect(capture.calls()).toBe(2);
    scheduler.stop();
  });

  it('stop() halts further ticks', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture.calls()).toBe(1);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(capture.calls()).toBe(1);
  });
});

describe('captureScheduler — manual mode', () => {
  it('does not fire on a timer; only on triggerCapture()', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({ captureOnce: capture.captureOnce, mode: 'manual' });
    scheduler.start(); // no-op in manual mode
    await vi.advanceTimersByTimeAsync(60_000);
    expect(capture.calls()).toBe(0);

    const ran = scheduler.triggerCapture();
    await vi.advanceTimersByTimeAsync(10);
    expect(await ran).toEqual({ status: 'ran' });
    expect(capture.calls()).toBe(1);
  });

  it('triggerCapture reports skipped when a capture is already in flight', async () => {
    const capture = makeCapture(1000);
    const scheduler = makeCaptureScheduler({ captureOnce: capture.captureOnce, mode: 'manual' });

    const first = scheduler.triggerCapture(); // starts, busy for 1000ms
    const second = scheduler.triggerCapture(); // immediately → busy → skipped
    expect(await second).toEqual({ status: 'skipped' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toEqual({ status: 'ran' });
    expect(capture.calls()).toBe(1);
  });
});

describe('captureScheduler — runtime reconfigure', () => {
  it('reflects the initial cadence in getConfig', () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
    });
    expect(scheduler.getConfig()).toEqual({ intervalMs: 5000, mode: 'interval' });
  });

  it('changing the interval while running restarts the timer at the new rate', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture.calls()).toBe(1);
    scheduler.reconfigure({ intervalMs: 1000 });
    expect(scheduler.getConfig().intervalMs).toBe(1000);
    await vi.advanceTimersByTimeAsync(3000); // 3 ticks at the new 1s rate
    expect(capture.calls()).toBe(4);
    scheduler.stop();
  });

  it('switching interval→manual stops ticking; manual→interval resumes', async () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 1000,
      mode: 'interval',
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(capture.calls()).toBe(2);

    scheduler.reconfigure({ mode: 'manual' }); // stop auto-ticking
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture.calls()).toBe(2); // no new ticks
    expect(scheduler.getConfig().mode).toBe('manual');

    scheduler.reconfigure({ mode: 'interval' }); // resume
    await vi.advanceTimersByTimeAsync(2000);
    expect(capture.calls()).toBe(4);
    scheduler.stop();
  });

  it('ignores a non-positive interval', () => {
    const capture = makeCapture(10);
    const scheduler = makeCaptureScheduler({
      captureOnce: capture.captureOnce,
      intervalMs: 5000,
      mode: 'interval',
    });
    scheduler.reconfigure({ intervalMs: 0 });
    expect(scheduler.getConfig().intervalMs).toBe(5000);
  });
});

describe('captureScheduler — errors', () => {
  it('reports a capture error and clears busy so the next capture can run', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const captureOnce = (): Promise<void> => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
    };
    const scheduler = makeCaptureScheduler({
      captureOnce,
      mode: 'manual',
      onError: (error) => errors.push(error),
    });
    const first = await scheduler.triggerCapture(); // ran, threw, recovered
    expect(first.status).toBe('error');
    expect(first).toMatchObject({ message: 'boom' });
    expect(errors).toHaveLength(1);
    expect(scheduler.isBusy()).toBe(false);
    expect(await scheduler.triggerCapture()).toEqual({ status: 'ran' }); // not stuck busy
    expect(calls).toBe(2);
  });
});
