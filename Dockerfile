# syntax=docker/dockerfile:1

# Stage 1: Build the web frontend
FROM oven/bun:1-alpine AS web
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY web/ ./web/
RUN bun run build

# Stage 2: Install production dependencies and trim unused pdfjs-dist assets
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production && \
    rm -rf node_modules/pdfjs-dist/build \
           node_modules/pdfjs-dist/web \
           node_modules/pdfjs-dist/types \
           node_modules/pdfjs-dist/webpack.mjs \
           node_modules/pdfjs-dist/legacy/build/*.min.mjs \
           node_modules/pdfjs-dist/legacy/build/pdf.sandbox.* && \
    find node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name 'README.md' -o -name 'CODE_OF_CONDUCT.md' \) -delete

# Stage 3: Minimal Bun Alpine runtime (pure JS CP037 decoder, no Rust toolchain)
FROM oven/bun:1-alpine AS runtime
LABEL org.opencontainers.image.title="expense-tracker" \
      org.opencontainers.image.description="Personal expense tracker with BPI and UnionBank PDF statement import" \
      org.opencontainers.image.source="https://github.com/tunitz/expense-tracker" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3020 \
    DATA_DIR=/data \
    WEB_DIR=/app/web/dist \
    EXPENSE_CP037_MODE=js

COPY --link --from=deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --link --chown=1000:1000 package.json tsconfig.json ./
COPY --link --chown=1000:1000 src/server ./src/server
COPY --link --from=web --chown=1000:1000 /app/web/dist ./web/dist

RUN find src/server -name '*.test.ts' -delete && \
    mkdir -p /data && \
    chown 1000:1000 /data && \
    chmod 700 /data

USER bun
VOLUME /data
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:3020/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["bun", "run", "src/server/main.ts"]
