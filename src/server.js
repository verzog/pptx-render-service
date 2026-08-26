// Proprietary — © 2026 Vernon Spain. All rights reserved.
//
// HTTP surface for the render service. One Chromium instance is launched at
// boot and reused; each request renders in its own isolated, network-denied
// browser context. Authentication is a shared bearer API key (swap for
// per-tenant keys / HMAC when this fronts real customers).

import Fastify from 'fastify';
import { chromium } from 'playwright';
import { renderSlide } from './render.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.RENDER_API_KEY || '';
const JS_ENABLED = process.env.RENDER_JS === '1';
const MAX_SLIDES = Number(process.env.RENDER_MAX_SLIDES) || 200;
const BODY_LIMIT = Number(process.env.RENDER_BODY_LIMIT) || 64 * 1024 * 1024; // 64 MB.

const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT });

let browser;

/** Rejects requests without a valid bearer key (when a key is configured). */
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/healthz') {
    return;
  }
  if (!API_KEY) {
    return; // No key configured — open mode, for local development only.
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) {
    reply.code(401).send({ error: 'unauthorized' });
  }
});

app.get('/healthz', async () => {
  return { status: browser ? 'ok' : 'starting' };
});

/**
 * POST /v1/render
 * Body: { slides: [{ html, width?, height?, scale?, assets? }] }
 * Returns: { pages: [{ index, format: 'png', data: <base64> }] }
 */
app.post('/v1/render', async (req, reply) => {
  const slides = Array.isArray(req.body?.slides) ? req.body.slides : null;
  if (!slides || slides.length === 0) {
    return reply.code(400).send({ error: 'slides[] required' });
  }
  if (slides.length > MAX_SLIDES) {
    return reply.code(413).send({ error: `too many slides (max ${MAX_SLIDES})` });
  }

  const pages = [];
  for (let i = 0; i < slides.length; i++) {
    const png = await renderSlide(browser, slides[i], { javaScriptEnabled: JS_ENABLED });
    pages.push({ index: i + 1, format: 'png', data: png.toString('base64') });
  }
  return { pages };
});

async function start() {
  browser = await chromium.launch({
    // The container itself is the sandbox (unprivileged, no network egress for
    // page contexts); see README for the deployment hardening this assumes.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  await app.listen({ port: PORT, host: HOST });
}

async function shutdown() {
  try {
    await app.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
