import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { listTestVideos, testPlayerHtml } from '../../src/sources/air/testPlayer.js';

describe('test player', () => {
	it('lists playable videos only, sorted', () => {
		const dir = mkdtempSync(join(tmpdir(), 'eagle-eye-videos-'));
		['b.mp4', 'a.WEBM', 'notes.txt', 'c.mov'].forEach((file) => writeFileSync(join(dir, file), ''));
		expect(listTestVideos(dir)).toEqual(['a.WEBM', 'b.mp4', 'c.mov']);
	});

	it('lists nothing when the directory is missing', () => {
		expect(listTestVideos('/nonexistent/eagle-eye/videos')).toEqual([]);
	});

	it('renders a paused player for the file, escaping the title', () => {
		const html = testPlayerHtml('night <1>.mp4');
		expect(html).toContain('src="/test-video/night%20%3C1%3E.mp4"');
		expect(html).toContain('<title>TEST · night &#60;1&#62;.mp4</title>');
		expect(html).not.toContain('autoplay');
	});
});
