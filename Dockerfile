# Stage 1: Build the web frontend
FROM oven/bun:1 AS web
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile
COPY web/ ./web/
RUN bun run build

# Stage 2: Install production dependencies for the server
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build the PDF decoder against the same Debian base as the runtime.
FROM rust:1.97-bookworm AS decoder
WORKDIR /build
COPY rust/statement-cp037/Cargo.toml rust/statement-cp037/Cargo.lock rust/statement-cp037/build.rs ./
COPY rust/statement-cp037/src ./src
RUN cargo build --release --locked && \
    cp target/release/libstatement_cp037.so /statement_cp037.node

# Slim runtime image
FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3020 DATA_DIR=/data WEB_DIR=/app/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY --from=decoder /statement_cp037.node ./rust/statement-cp037/statement_cp037.node
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
