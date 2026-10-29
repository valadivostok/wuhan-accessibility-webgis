FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY py/requirements-accessibility.txt ./py/requirements-accessibility.txt
RUN python3 -m venv /opt/gis-python \
    && /opt/gis-python/bin/pip install --no-cache-dir -r py/requirements-accessibility.txt
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    GIS_PYTHON=/opt/gis-python/bin/python \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node py/accessibility.py ./py/accessibility.py
COPY --chown=node:node public/data/demo/water.geojson ./public/data/demo/water.geojson
COPY --from=frontend --chown=node:node /app/dist ./dist
RUN mkdir -p tmp/satellite-tiles && chown -R node:node tmp
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/serve.mjs"]
