import type { Browser, Page } from 'puppeteer-core';

import puppeteer from 'puppeteer-core';

// Captures a frame of the on-air stream by ATTACHING to a Chrome you already have
// open and logged in (CDP over browserURL), so there's no re-auth against the DRM'd
// player. Launch that Chrome with --remote-debugging-port=9222 (see npm run
// chrome). We connect, find the target tab by URL substring, screenshot it,
// and DISCONNECT — your browser keeps running untouched.
//
// urlMatch is a GETTER read fresh each capture, so the web UI can switch which tab
// is grabbed at runtime without a restart. When no tab matches and openUrl names a page
// for it, that page is opened in a new tab and captured.
//
// Frames are always 1920×1080: the tab's viewport is pinned there at 1× (CDP emulation,
// which lasts as long as this connection), whatever the window's size or the display's
// pixel density. The template crop regions are fractions of a full 16:9 frame, and a
// bigger frame only gets shrunk again before the vision calls.
//
// DRM caveat: stream.directv.com is Widevine-protected. A CDP screenshot of
// protected video can come back BLACK (the protected layer doesn't composite into
// page.screenshot). The air probe verified real pixels for this stream; if a
// different surface comes back black, fall back to a macOS window screencapture.

export type BrowserCapturer = {
	captureOnce: () => Promise<Buffer>;
	close: () => Promise<void>;
};

export type BrowserCapturerConfig = {
	browserURL?: string; // default http://localhost:9222
	// What to open when no tab matches, read per capture; undefined = report the missing tab.
	// Its URL must contain urlMatch, so the next capture finds it.
	openUrl?: () => string | undefined;
	urlMatch?: () => string; // substring the target tab URL must contain; read per capture
};

export const DEFAULT_BROWSER_URL = 'http://localhost:9222';
export const DEFAULT_URL_MATCH = 'directv';
export const DIRECTV_PLAYER_URL = 'https://stream.directv.com/player';
const FRAME = { deviceScaleFactor: 1, height: 1080, width: 1920 };
const RELAYOUT_MS = 500; // let the page lay itself out at the new size before the first shot

export const makeBrowserCapturer = (config: BrowserCapturerConfig = {}): BrowserCapturer => {
	const browserURL = config.browserURL ?? DEFAULT_BROWSER_URL;
	const getUrlMatch = config.urlMatch ?? ((): string => DEFAULT_URL_MATCH);
	let browser: Browser | undefined;

	// Re-resolve the connection + tab each capture: tabs come and go, the match can
	// change from the UI, and a stale page handle throws. Cheap at once-per-5s.
	const findPage = async (): Promise<Page> => {
		if (browser === undefined || !browser.connected)
			browser = await puppeteer.connect({ browserURL, defaultViewport: null });
		const urlMatch = getUrlMatch();
		const pages = await browser.pages();
		const match = pages.find((page) => page.url().includes(urlMatch));
		if (match !== undefined) return match;
		const openUrl = config.openUrl?.();
		if (openUrl === undefined)
			throw new Error(
				`no open tab whose URL contains "${urlMatch}" (checked ${pages.length} tab(s)). Is the stream open in the debug Chrome?`,
			);
		const opened = await browser.newPage();
		try {
			await opened.goto(openUrl, { waitUntil: 'load' });
		} catch (error) {
			// Close it, or every failed capture would leave another dead tab behind.
			await opened.close();
			throw new Error(`no tab matched "${urlMatch}", and opening ${openUrl} failed`, {
				cause: error,
			});
		}
		console.log(`[air] no tab matched "${urlMatch}"; opened ${openUrl}`);
		return opened;
	};

	return {
		captureOnce: async () => {
			const page = await findPage();
			const viewport = page.viewport();
			if (viewport?.width !== FRAME.width || viewport.height !== FRAME.height) {
				await page.setViewport(FRAME);
				await new Promise((resolve) => setTimeout(resolve, RELAYOUT_MS));
			}
			const shot = await page.screenshot({ type: 'png' });
			return Buffer.from(shot);
		},
		close: async () => {
			// disconnect (NOT close) — leave the user's browser running.
			if (browser !== undefined && browser.connected) browser.disconnect();
			browser = undefined;
		},
	};
};
