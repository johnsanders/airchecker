import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

import { makeBrowserCapturer } from '../sources/air/browserCapturer.js';

// Captures one frame from the attached DirecTV tab and reports whether it's REAL
// pixels or a (DRM) black frame — the key unknown for browser capture of protected
// video. Saves the PNG to /tmp/air_probe.png so it can be eyeballed too.
//
//   npm run air:probe        (Chrome must be running via npm run chrome:debug)

const run = async (): Promise<void> => {
  const match = process.env.AIR_URL_MATCH ?? 'directv';
  const capturer = makeBrowserCapturer({
    browserURL: process.env.AIR_BROWSER_URL ?? 'http://localhost:9222',
    urlMatch: () => match,
  });

  let png: Buffer;
  try {
    png = await capturer.captureOnce();
  } finally {
    await capturer.close();
  }

  const outPath = '/tmp/air_probe.png';
  writeFileSync(outPath, png);

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let dark = 0;
  let pixels = 0;
  for (let i = 0; i < data.length; i += channels) {
    pixels += 1;
    if (data[i]! <= 8 && data[i + 1]! <= 8 && data[i + 2]! <= 8) dark += 1;
  }
  const darkPct = Math.round((dark / pixels) * 1000) / 10;

  console.log(`captured ${info.width}×${info.height}, ${png.length} bytes → ${outPath}`);
  console.log(`near-black pixels: ${darkPct}%`);
  if (darkPct > 95)
    console.log('VERDICT: looks BLACK — DRM likely blocking the screenshot. Fall back to screencapture of the window.');
  else console.log('VERDICT: real pixels — browser capture works for the DirecTV stream. 🎉');
};

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
