# pptx-render-service

Proprietary render backend for the PowerPoint import plugins
([booktool_importpptx](https://github.com/verzog/moodle-booktool_importpptx) /
[local_lessonimportpptx](https://github.com/verzog/moodle-lessontool_importpptx)).

It rasterises **reconstructed slide HTML** to page images with headless
Chromium. The plugin parses the uploaded `.pptx` in memory-safe PHP and produces
a fixed-size slide document (`slide_html_builder`); this service only ever sees
that HTML plus the slide's own images. **The untrusted Office file never reaches
this service and no Office engine runs here** — which is the whole security point
of the design.

> **License:** proprietary. © 2026 Vernon Spain. All rights reserved. This is the
> paid backend in an open-core split: the Moodle plugins stay GPLv3 and free; this
> service is not distributed and is not GPL. Do not add an open-source license.

## Contract

### `POST /v1/render`

Auth: `Authorization: Bearer <RENDER_API_KEY>`

```jsonc
{
  "slides": [
    {
      "html": "<div class=\"booktool-importpptx-slide\" style=\"...\">…</div>",
      "width": 1280,          // optional, px (default 1280)
      "height": 720,          // optional, px (default 720)
      "scale": 2,             // optional, deviceScaleFactor 1–4 (default 2)
      "assets": {             // optional, referenced images
        "pic.png": "<base64 bytes>"
      }
    }
  ]
}
```

Response:

```jsonc
{ "pages": [ { "index": 1, "format": "png", "data": "<base64 PNG>" } ] }
```

The service inlines every `assets` entry into the HTML (replacing the plugin's
`@@PLUGINFILE@@/<name>` references with `data:` URIs), so the rendered page needs
**no network access at all**.

### `GET /healthz`

`{ "status": "ok" }` once Chromium is up.

## How the plugin calls it

The plugin's `cloud_renderer` (an implementation of the `render_backend`
interface) does, per deck:

1. For each slide, build canvas HTML with `slide_html_builder` and collect the
   referenced media (converting WMF/EMF to PNG as the importer already does).
2. `POST /v1/render` with the slides + base64 assets and the site's API key.
3. Yield each returned PNG from `render_pages()` — identical shape to the
   LibreOffice backend, so `office_importer`/`import_task` are unchanged.

## Security posture

- **No Office parsing here.** Chromium only renders HTML the plugin generated.
- **Network-denied rendering.** Every page context aborts all requests except
  `data:` URIs, so inlined assets load and nothing can phone out (no SSRF /
  exfiltration).
- **JavaScript off by default** (`RENDER_JS=0`); the static slide HTML needs
  none. Turn on only if you add in-page auto-fit that must run pre-screenshot.
- **Per-request isolation.** A fresh browser context per request, closed after.
- **Run it locked down.** Unprivileged user (the image's `pwuser`), read-only
  root FS where possible, per-container CPU/memory/PID limits, request timeouts,
  and no outbound egress from the container. Put it behind TLS and a gateway
  that terminates auth/rate-limits; never expose it to the public internet raw.
- **Data protection.** Slides may contain personal data. Hold nothing: inputs
  and outputs live only for the request. Document retention and sign a DPA
  before processing customer content; the plugin discloses the external transfer
  via its privacy provider.

## Run locally

```bash
npm install
npx playwright install chromium      # first time only
RENDER_API_KEY=dev npm start
# smoke test
npm test
```

## Build & run the container

```bash
docker build -t pptx-render-service .
docker run --rm -p 3000:3000 \
  -e RENDER_API_KEY=change-me \
  --read-only --tmpfs /tmp \
  --pids-limit 256 --memory 1g \
  pptx-render-service
```

## Scaling notes

One Chromium handles a handful of concurrent renders comfortably; it is CPU/RAM
bound, not IO bound. For real load put a queue in front and run N stateless
replicas (this service holds no state between requests). Meter per rendered
**page** — the natural billing unit and what `pages[]` returns.

## Roadmap

- `cloud_renderer` in the plugins (calls this) + admin settings (URL, API key,
  "Test connection") + privacy disclosure.
- Optional `POST /v1/render` variant returning a multi-page PDF.
- In-page auto-fit measurement (replacing the PHP shrink-to-fit estimate),
  behind `RENDER_JS=1`.
- Per-tenant keys, quota/metering, and billing when this fronts customers.
