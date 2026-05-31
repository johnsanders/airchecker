import { randomUUID } from 'node:crypto';

import makeRecorder from '../replay/recorder.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import { makeProviderSource } from '../sources/provider/providerSource.js';
import { makeVendorSource } from '../sources/vendor/vendorSource.js';
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

	// DDHQ provider source: poll once per minute (skip-if-busy via its own scheduler).
	// Only started if credentials are present, so the air/cadence scaffold still runs
	// without DDHQ configured.
	let providerScheduler: ReturnType<typeof makeCaptureScheduler> | undefined;
	if (process.env.DDHQ_CLIENT_ID !== undefined) {
		const provider = makeProviderSource((observations) =>
			observations.forEach(composition.store.record),
		);
		providerScheduler = makeCaptureScheduler({
			captureOnce: provider.poller.pollOnce,
			intervalMs: provider.intervalMs,
			mode: 'interval',
			onError: (error) => console.error('[provider] poll error', error),
			onSkip: () => console.warn('[provider] poll skipped — previous still in flight'),
		});
		providerScheduler.start();
		console.log(
			`[provider] DDHQ polling every ${provider.intervalMs}ms across ${provider.queries.length} quer${provider.queries.length === 1 ? 'y' : 'ies'}.`,
		);
	} else {
		console.log('[provider] DDHQ not configured (no DDHQ_CLIENT_ID) — skipping.');
	}

	// Chameleon vendor source: poll the fixed playlist URL once per minute (VPN-only).
	let vendorScheduler: ReturnType<typeof makeCaptureScheduler> | undefined;
	if (process.env.CHAMELEON_URL !== undefined) {
		const vendor = makeVendorSource((observations) =>
			observations.forEach(composition.store.record),
		);
		vendorScheduler = makeCaptureScheduler({
			captureOnce: vendor.poller.pollOnce,
			intervalMs: vendor.intervalMs,
			mode: 'interval',
			onError: (error) => console.error('[vendor] poll error', error),
			onSkip: () => console.warn('[vendor] poll skipped — previous still in flight'),
		});
		vendorScheduler.start();
		console.log(`[vendor] Chameleon polling every ${vendor.intervalMs}ms.`);
	} else {
		console.log('[vendor] Chameleon not configured (no CHAMELEON_URL) — skipping.');
	}

	const shutdown = (): void => {
		scheduler.stop();
		providerScheduler?.stop();
		vendorScheduler?.stop();
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
