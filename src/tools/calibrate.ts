import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';

import { scaleRectToFrame } from '../templates/geometry.js';
import { findTemplate, templateRegistry } from '../templates/registry.js';

// Crops a template's captureRegion (normalized fractions) out of a reference frame
// so the region can be eyeballed — if the whole graphic is in the crop, the region
// is good (the VLM localizes the fields within it).
//
//   npm run calibrate <templateId> <framePng>

const run = async (): Promise<void> => {
  const templateId = process.argv[2];
  const framePath = process.argv[3];
  if (templateId === undefined || framePath === undefined) {
    console.error('Usage: npm run calibrate <templateId> <framePng>');
    process.exit(1);
  }

  const spec = findTemplate(templateId);
  if (spec === undefined) {
    console.error(`Unknown template "${templateId}". Known: ${templateRegistry.map((t) => t.id).join(', ')}`);
    process.exit(1);
  }
  if (spec.captureRegion === undefined) {
    console.error(`Template "${templateId}" has no captureRegion (locatable template).`);
    process.exit(1);
  }

  // metadata() reports wrong dimensions for some of these PNGs, so decode to get
  // the true pixel size — the space extract() actually operates in.
  const decoded = await sharp(framePath).raw().toBuffer({ resolveWithObject: true });
  const frameWidth = decoded.info.width;
  const frameHeight = decoded.info.height;

  const region = scaleRectToFrame(spec.captureRegion, frameWidth, frameHeight);
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const width = Math.min(frameWidth - left, region.w);
  const height = Math.min(frameHeight - top, region.h);

  const outDir = 'recordings/_calibrated';
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/${templateId}__${basename(framePath).replace(/\.[^.]+$/, '')}.crop.png`;

  await sharp(framePath)
    .extract({ height, left, top, width })
    .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(outPath);

  console.log(`${spec.id} (${spec.surface}) — frame ${frameWidth}×${frameHeight}`);
  console.log(`region px: left ${left}, top ${top}, ${width}×${height}`);
  console.log(`wrote ${outPath}`);
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
