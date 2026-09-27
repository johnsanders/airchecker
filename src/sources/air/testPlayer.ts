import { readdirSync } from 'node:fs';
import { extname } from 'node:path';
import puppeteer from 'puppeteer-core';

// The TEST air source: a recorded broadcast from recordings/video played back in the
// debug Chrome, so the whole pipeline can be exercised without a live stream. The web
// server serves the file and a bare player page; the capturer grabs frames straight
// off that page's <video> at the file's native resolution (see browserCapturer).

// Path prefix of the player page — also the capture tab match while TEST is selected.
export const TEST_PLAYER_PATH = '/test-player/';
export const TEST_VIDEO_PATH = '/test-video/';
export const TEST_VIDEO_ELEMENT_ID = 'test-video';

const PLAYABLE = new Set(['.m4v', '.mov', '.mp4', '.webm']);

export const listTestVideos = (dir: string): string[] => {
	try {
		return readdirSync(dir)
			.filter((file) => PLAYABLE.has(extname(file).toLowerCase()))
			.sort();
	} catch {
		return []; // no recordings/video yet
	}
};

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Loads paused; the operator plays, pauses and scrubs it.
export const testPlayerHtml = (file: string): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>TEST · ${escapeHtml(file)}</title>
<style>
html, body { margin: 0; height: 100%; background: #000; }
video { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
<video id="${TEST_VIDEO_ELEMENT_ID}" controls preload="auto" src="${TEST_VIDEO_PATH}${encodeURIComponent(file)}"></video>
</body>
</html>`;

// Open the player in the debug Chrome, replacing any earlier test tab so the capturer's
// tab match stays unambiguous. Disconnects afterwards, leaving the browser running.
export const openTestPlayer = async (browserURL: string, playerUrl: string): Promise<void> => {
	const browser = await puppeteer.connect({ browserURL, defaultViewport: null });
	try {
		const pages = await browser.pages();
		await Promise.all(
			pages.filter((page) => page.url().includes(TEST_PLAYER_PATH)).map((page) => page.close()),
		);
		const page = await browser.newPage();
		await page.goto(playerUrl);
		await page.bringToFront();
	} finally {
		await browser.disconnect();
	}
};
