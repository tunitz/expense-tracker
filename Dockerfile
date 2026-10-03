# Stage 1: Build the web frontend
FROM oven/bun:1 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# Stage 2: Install production dependencies for the server
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 3: Slim runtime image
FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3020 DATA_DIR=/data WEB_DIR=/app/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY tsconfig.json ./
COPY --from=web /app/web/dist ./web/dist

RUN find src/server -name '*.test.ts' -delete && \
    mkdir -p /data && \
    chown -R bun:bun /data /app
USER bun

VOLUME /data
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s \
    CMD bun -e "fetch('http://localhost:3020/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun","run","src/server/main.ts"]
