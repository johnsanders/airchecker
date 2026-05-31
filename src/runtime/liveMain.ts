import { randomUUID } from 'node:crypto';

import makeRecorder from '../replay/recorder.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import makeComposition from './composition.js';

// Capture cadence is env-configurable:
//   CAPTURE_MODE=interval|manual   (default interval)
//   CAPTURE_INTERVAL_MS=<n>        (default 5000; interval mode only)
const readCaptureMode = (): CaptureMode =>
	process.env.CAPTURE_MODE === 'manual' ? 'manual' : 'interval';
const readIntervalMs = (): number => {
	const raw = Number(process.env.CAPTURE_INTERVAL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

const liveMain = async (): Promise<void> => {
	const sessionId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	const recorder = makeRecorder({ baseDir: 'recordings', sessionId });
	const composition = makeComposition({
		onRecord: recorder.recordObservation,
	});

	// One capture = grab a frame, run extractFrame, push observations to the store.
	// BLOCKED: the screenshot grab (DirecTV window) + extractFrame wiring land here
	// once the capture mechanism is chosen. Until then this is a no-op stand-in so
	// the cadence is exercisable end-to-end.
	const captureOnce = async (): Promise<void> => {
		console.log(`[live] capture tick @ ${new Date().toISOString()} (no capturer wired yet)`);
	};

	const mode = readCaptureMode();
	const intervalMs = readIntervalMs();
	const scheduler = makeCaptureScheduler({
		captureOnce,
		intervalMs,
		mode,
		onError: (error) => console.error('[live] capture error', error),
		onSkip: () => console.warn('[live] capture skipped — previous still in flight'),
	});

	const shutdown = (): void => {
		scheduler.stop();
		recorder.close();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	scheduler.start();
	// scheduler.triggerCapture() is the manual entry point — the Fastify web button
	// will call it once the web view exists; in manual mode it's the only trigger.
	console.log(
		`[live] session ${sessionId} ready; mode=${mode}${mode === 'interval' ? ` every ${intervalMs}ms` : ' (manual trigger only)'}; ${composition.store.getRaceKeys().length} races tracked.`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
