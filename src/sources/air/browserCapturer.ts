import type { Browser, Page } from 'puppeteer-core';

import puppeteer from 'puppeteer-core';

import { TEST_PLAYER_PATH, TEST_VIDEO_ELEMENT_ID } from './testPlayer.js';

// Captures a frame of the on-air stream by ATTACHING to a Chrome you already have
// open and logged in (CDP over browserURL), so there's no re-auth against the DRM'd
// player. Launch that Chrome with --remote-debugging-port=9222 (see npm run
// chrome:debug). We connect, find the target tab by URL substring, screenshot it,
// and DISCONNECT — your browser keeps running untouched.
//
// urlMatch is a GETTER read fresh each capture, so the web UI can switch which tab
// is grabbed at runtime without a restart.
//
// DRM caveat: stream.directv.com is Widevine-protected. A CDP screenshot of
// protected video can come back BLACK (the protected layer doesn't composite into
// page.screenshot). The air probe verified real pixels for this stream; if a
// different surface comes back black, fall back to a macOS window screencapture.
//
// The TEST player tab is the exception: its frame is drawn off the <video> element at
// the file's native resolution, not screenshotted, so it matches the 1920×1080 the
// templates are authored against whatever the window size or pixel density.

export type BrowserCapturer = {
	captureOnce: () => Promise<Buffer>;
	close: () => Promise<void>;
};

export type BrowserCapturerConfig = {
	browserURL?: string; // default http://localhost:9222
	urlMatch?: () => string; // substring the target tab URL must contain; read per capture
};

export const DEFAULT_BROWSER_URL = 'http://localhost:9222';
const DEFAULT_URL_MATCH = 'directv';

// Evaluated in the page (a string: the backend compiles without DOM types). Yields a
// PNG data URL of whatever frame the video is showing, playing or paused.
const GRAB_VIDEO_FRAME = `(() => {
	const video = document.getElementById(${JSON.stringify(TEST_VIDEO_ELEMENT_ID)});
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	canvas.getContext('2d').drawImage(video, 0, 0);
	return canvas.toDataURL('image/png');
})()`;

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
		if (match === undefined)
			throw new Error(
				`no open tab whose URL contains "${urlMatch}" (checked ${pages.length} tab(s)). Is the stream open in the debug Chrome?`,
			);
		return match;
	};

	return {
		captureOnce: async () => {
			const page = await findPage();
			if (page.url().includes(TEST_PLAYER_PATH)) {
				const dataUrl = (await page.evaluate(GRAB_VIDEO_FRAME)) as string;
				return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
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
