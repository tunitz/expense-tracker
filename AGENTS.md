# AGENTS.md

Instructions for AI coding agents and contributors working in this repository.

## Mandatory Git & Pull Request Rules

**NEVER commit directly to `main` and NEVER push directly to `main`.**

1. **Always branch from an up-to-date `main` using `feature/<short-kebab-name>`** before making any changes:
   ```bash
   git checkout main && git pull --ff-only origin main
   git checkout -b feature/<short-kebab-name>
   ```
2. **Always open a Pull Request into `main`** (`gh pr create --base main`) and wait for CI checks to pass before merging. Do not bypass branch workflow with direct pushes to `main`.
3. **Use Conventional Commits** on every commit and PR title (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, or `feat!:` / `BREAKING CHANGE:` for breaking changes). Merging into `main` triggers `.github/workflows/release.yml`, which inspects commit messages since the last SemVer tag to automatically compute the next `vMAJOR.MINOR.PATCH` tag, create a GitHub Release, and build/publish multi-arch GHCR container images.

## Architecture Overview

- **Runtime & HTTP Server:** Bun + Hono (`src/server/main.ts`, `src/server/app.ts`).
- **Database:** SQLite via `bun:sqlite` (`src/server/db.ts`), stored at `$DATA_DIR/app.db` (default `./data/app.db`, owner-only permissions). All monetary amounts are stored as integer minor units (`amount_minor`, PHP centavos).
- **Auth & Security:** Argon2id password hashing, SHA-256 hashed 32-byte session tokens stored in `sessions` with `HttpOnly` `SameSite=Lax` cookies (`sid`), per-IP and per-account sliding-window rate limiting, and strict CSP/security headers.
- **PDF Statement Parsing:** `pdfjs-dist` (`src/server/parsers/extract.ts`) extracts text in memory with a 15 MB / 50-page cap, plus BPI (`bpi.ts`) and UnionBank (`unionbank.ts`) parsers and optional CP037 EBCDIC decoding (`statement-encoding.ts` + TypeScript `cp037.ts` or optional Rust N-API addon in `rust/statement-cp037/`).
- **Web Frontend:** React + Tailwind CSS bundled directly with Bun (`web/build.ts`, `web/dev.ts`, `web/src/`). No Vite.

## Common Commands

```bash
# Install dependencies
bun install --frozen-lockfile

# Development (API on :3020 with --watch, web dev proxy on :3000)
bun run dev

# Verification suite (run before committing/opening a PR)
EXPENSE_CP037_MODE=js bun test
bun test
bun run typecheck
bun run lint
bun run build
```

## Coding & Security Rules

- **Strict user isolation:** Every query and mutation on `accounts`, `documents`, `categories`, `merchant_rules`, and `transactions` must scope by `user_id = c.get('user').id`. Never leak existence of another user's records (return `404` on foreign IDs).
- **Never commit private data or scratch artifacts:** Do not commit `.env`, `data/`, `fixtures/private/`, PDF statements, personal passwords/card numbers, or tool/debug logs.
- **Private-fixture test guards:** Tests referencing `fixtures/private/` must skip cleanly via `existsSync(...)` / `skipIf(!hasFixture)` so `bun test` passes in CI and fresh clones.
- **Docker & Compose:** The production `Dockerfile` targets `oven/bun:1-alpine` in pure-JS mode (`EXPENSE_CP037_MODE=js`) with non-root `USER bun`. Use `compose.yaml` (canonical filename, no `docker-compose.yml`) for production GHCR image deployment and `compose.dev.yaml` for local source builds.
