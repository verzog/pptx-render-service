# Proprietary — © 2026 Vernon Spain. All rights reserved.
#
# Playwright's image ships Chromium and its OS dependencies pinned to the
# playwright npm version. Keep the tag in step with the "playwright" dependency
# in package.json.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

# Metric-compatible faces so rendered text matches what the plugin measured:
# Carlito≈Calibri/Aptos, Caladea≈Cambria, Liberation≈Arial/Times.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    PORT=3000

# Playwright's base image provides the unprivileged "pwuser".
USER pwuser

EXPOSE 3000
CMD ["node", "src/server.js"]
