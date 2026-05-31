import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

// Captures a frame of the DirecTV stream by ATTACHING to a Chrome you already have
// open and logged in (CDP over browserURL), so there's no re-auth against the DRM'd
// player. Launch that Chrome with --remote-debugging-port=9222 (see npm run
// chrome:debug). We connect, find the DirecTV tab by URL, screenshot it, and
// DISCONNECT — your browser keeps running untouched.
//
// DRM caveat: stream.directv.com is Widevine-protected. A CDP screenshot of
// protected video can come back BLACK (the protected layer doesn't composite into
// page.screenshot). captureBrowserFrame() returns the PNG either way; whether it's
// real pixels or a black rectangle is the first thing to verify live. If black, the
// fallback is a macOS screencapture of the window (separate capturer).

export type BrowserCapturerConfig = {
  browserURL?: string; // default http://localhost:9222
  urlMatch?: string; // substring the target tab's URL must contain; default 'directv'
};

export type BrowserCapturer = {
  captureOnce: () => Promise<Buffer>;
  close: () => Promise<void>;
};

const DEFAULT_BROWSER_URL = 'http://localhost:9222';
const DEFAULT_URL_MATCH = 'directv';

export const makeBrowserCapturer = (config: BrowserCapturerConfig = {}): BrowserCapturer => {
  const browserURL = config.browserURL ?? DEFAULT_BROWSER_URL;
  const urlMatch = config.urlMatch ?? DEFAULT_URL_MATCH;
  let browser: Browser | undefined;

  // Re-resolve the connection + tab each capture: tabs come and go, and a stale
  // page handle throws. Cheap enough at once-per-5s.
  const findPage = async (): Promise<Page> => {
    if (browser === undefined || !browser.connected)
      browser = await puppeteer.connect({ browserURL, defaultViewport: null });
    const pages = await browser.pages();
    const match = pages.find((page) => page.url().includes(urlMatch));
    if (match === undefined)
      throw new Error(
        `no open tab whose URL contains "${urlMatch}" (checked ${pages.length} tab(s)). Is the DirecTV stream open in the debug Chrome?`,
      );
    return match;
  };

  return {
    captureOnce: async () => {
      const page = await findPage();
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
