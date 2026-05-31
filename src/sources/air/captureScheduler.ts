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

export type CadenceConfig = {
  intervalMs: number;
  mode: CaptureMode;
};

// 'ran' = captured cleanly; 'skipped' = a capture was already in flight;
// 'error' = the capture itself threw (carries the message). The manual web button
// needs this distinction — reporting "captured" on a failed grab is misleading.
export type CaptureResult =
  | { status: 'ran' }
  | { status: 'skipped' }
  | { message: string; status: 'error' };

export type CaptureScheduler = {
  getConfig: () => CadenceConfig;
  isBusy: () => boolean;
  // Change mode and/or interval at runtime (the web cadence control). If currently
  // running, the timer is restarted under the new settings. Partial — only the
  // provided fields change.
  reconfigure: (next: Partial<CadenceConfig>) => void;
  // Manual / web-button entry. Works in BOTH modes; reports the true outcome.
  triggerCapture: () => Promise<CaptureResult>;
  start: () => void; // begins interval ticking in interval mode; no-op in manual mode
  stop: () => void; // clears the interval; triggerCapture still works after stop()
};

const DEFAULT_INTERVAL_MS = 5000;

export const makeCaptureScheduler = (config: CaptureSchedulerConfig): CaptureScheduler => {
  let busy = false;
  let running = false; // whether start() is in effect (vs stopped)
  let timer: ReturnType<typeof setInterval> | undefined;
  let mode: CaptureMode = config.mode;
  let intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;

  const runOnce = async (): Promise<CaptureResult> => {
    if (busy) {
      config.onSkip?.();
      return { status: 'skipped' };
    }
    busy = true;
    try {
      await config.captureOnce();
      return { status: 'ran' };
    } catch (error) {
      config.onError?.(error);
      return { message: error instanceof Error ? error.message : String(error), status: 'error' };
    } finally {
      busy = false;
    }
  };

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  // Bring the timer in line with the current mode + running state.
  const syncTimer = (): void => {
    clearTimer();
    if (running && mode === 'interval')
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
  };

  return {
    getConfig: () => ({ intervalMs, mode }),
    isBusy: () => busy,
    reconfigure: (next) => {
      if (next.mode !== undefined) mode = next.mode;
      if (next.intervalMs !== undefined && next.intervalMs > 0) intervalMs = next.intervalMs;
      syncTimer();
    },
    start: () => {
      running = true;
      syncTimer();
    },
    stop: () => {
      running = false;
      clearTimer();
    },
    triggerCapture: runOnce,
  };
};
