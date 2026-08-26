// Proprietary — © 2026 Vernon Spain. All rights reserved.
//
// Smoke tests. inlineAssets runs anywhere; the Chromium render test needs the
// Playwright browser and is skipped automatically when it is not installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAssets } from '../src/render.js';

test('inlineAssets rewrites @@PLUGINFILE@@ and src references to data URIs', () => {
  // 1x1 transparent PNG.
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const html = '<img src="@@PLUGINFILE@@/pic.png"><img src="pic.png">';
  const out = inlineAssets(html, { 'pic.png': b64 });
  assert.ok(out.includes(`data:image/png;base64,${b64}`));
  assert.ok(!out.includes('@@PLUGINFILE@@'));
  assert.ok(!out.includes('src="pic.png"'));
});

test('inlineAssets leaves html untouched when there are no assets', () => {
  const html = '<div class="booktool-importpptx-slide"><p>Hi</p></div>';
  assert.equal(inlineAssets(html, {}), html);
});

test('renderSlide produces a PNG (needs Playwright Chromium)', async (t) => {
  // In CI the browser is installed on purpose, so a missing/unlaunchable
  // Chromium is a real failure — never let it silently skip. Locally (no CI
  // env) the test still skips so the suite runs without a browser.
  const strict = !!process.env.CI;
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    if (strict) throw err;
    t.skip('playwright not installed');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
  } catch (err) {
    if (strict) throw err;
    t.skip('chromium browser not available');
    return;
  }
  try {
    const { renderSlide } = await import('../src/render.js');
    const png = await renderSlide(
      browser,
      { html: '<div style="width:100px;height:100px;background:#08c"></div>', width: 100, height: 100, scale: 1 },
      {}
    );
    // PNG magic number.
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    await browser.close();
  }
});
