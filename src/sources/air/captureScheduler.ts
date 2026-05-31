// Drives WHEN a frame is captured — interval ticking and/or manual one-offs —
// independent of HOW (the screenshot mechanism) and what runs after (extractFrame).
// The actual capture is an injected `captureOnce` thunk so this layer is pure
// scheduling and fully testable with fake timers.
//
// Skip-if-busy: a VLM round-trip can outlast the interval, so a tick that fires
// while a capture is still in flight is DROPPED (never queued, never concurrent) —
// at worst we miss a frame; the next tick is one interval away.

export type CaptureMode = 'interval' | 'manual';

export type CaptureSchedulerConfig = {
  captureOnce: () => Promise<void>;
  intervalMs?: number; // interval mode only; default 5000
  mode: CaptureMode;
  onError?: (error: unknown) => void;
  onSkip?: () => void; // called when a fire is dropped because a capture is in flight
};

export type CaptureScheduler = {
  isBusy: () => boolean;
  // Manual / web-button / keypress entry. Works in BOTH modes. Resolves true if a
  // capture ran, false if it was skipped (already busy).
  triggerCapture: () => Promise<boolean>;
  start: () => void; // begins interval ticking in interval mode; no-op in manual mode
  stop: () => void; // clears the interval; triggerCapture still works after stop()
};

const DEFAULT_INTERVAL_MS = 5000;

export const makeCaptureScheduler = (config: CaptureSchedulerConfig): CaptureScheduler => {
  let busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const runOnce = async (): Promise<boolean> => {
    if (busy) {
      config.onSkip?.();
      return false;
    }
    busy = true;
    try {
      await config.captureOnce();
    } catch (error) {
      config.onError?.(error);
    } finally {
      busy = false;
    }
    return true;
  };

  const start = (): void => {
    if (config.mode !== 'interval' || timer !== undefined) return;
    const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
  };

  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  return {
    isBusy: () => busy,
    start,
    stop,
    triggerCapture: runOnce,
  };
};
