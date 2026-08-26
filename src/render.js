// Proprietary — © 2026 Vernon Spain. All rights reserved.
//
// Core rendering: turn a reconstructed slide's HTML (plus its inlined image
// assets) into a PNG, using a sandboxed headless-Chromium page. The untrusted
// .pptx is never seen here — only HTML the plugin generated from its own parse.

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * Replaces the plugin's @@PLUGINFILE@@/<name> references (and bare src="<name>")
 * with data: URIs built from the supplied assets, so the rendered page needs no
 * network access at all.
 *
 * @param {string} html Slide HTML from slide_html_builder.
 * @param {Record<string,string>} assets Map of file-area name -> base64 bytes.
 * @returns {string} HTML with every asset reference inlined.
 */
export function inlineAssets(html, assets = {}) {
  let out = html;
  for (const [name, b64] of Object.entries(assets)) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    const uri = `data:${mime};base64,${b64}`;
    // @@PLUGINFILE@@/name  and  src="name"  (the two forms the builders emit).
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@@PLUGINFILE@@/${escaped}`, 'g'), uri);
    out = out.replace(new RegExp(`(src=")${escaped}(")`, 'g'), `$1${uri}$2`);
  }
  return out;
}

/**
 * Wraps a slide fragment in a minimal, self-contained HTML document. Fonts are
 * the metric-compatible faces installed in the image (see Dockerfile), declared
 * so the render matches what the plugin measured.
 *
 * @param {string} body Inlined slide HTML.
 * @returns {string} A full HTML document.
 */
function documentFor(body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;}
  body{font-family:"Carlito","Liberation Sans",sans-serif;}
  *{box-sizing:border-box;}
</style></head><body>${body}</body></html>`;
}

/**
 * Renders one slide to a PNG buffer in an isolated, network-denied context.
 *
 * @param {import('playwright').Browser} browser A launched Chromium instance.
 * @param {object} slide { html, width?, height?, scale? }.
 * @param {object} opts { javaScriptEnabled, timeoutMs }.
 * @returns {Promise<Buffer>} PNG bytes.
 */
export async function renderSlide(browser, slide, opts = {}) {
  const width = Number(slide.width) > 0 ? Math.floor(slide.width) : 1280;
  const height = Number(slide.height) > 0 ? Math.floor(slide.height) : 720;
  const scale = Number(slide.scale) > 0 ? Math.min(Number(slide.scale), 4) : 2;
  const timeout = Number(opts.timeoutMs) > 0 ? opts.timeoutMs : 15000;

  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    javaScriptEnabled: opts.javaScriptEnabled === true,
  });
  // Deny every network request: all assets are inlined as data: URIs, so a page
  // that reaches out is either broken or hostile. This blocks SSRF/exfiltration.
  await context.route('**', (route) => {
    return route.request().url().startsWith('data:') ? route.continue() : route.abort();
  });

  try {
    const page = await context.newPage();
    const html = documentFor(inlineAssets(slide.html || '', slide.assets));
    await page.setContent(html, { waitUntil: 'load', timeout });
    const clip = { x: 0, y: 0, width, height };
    return await page.screenshot({ type: 'png', clip });
  } finally {
    await context.close();
  }
}
