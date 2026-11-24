# Expense Tracker

A personal expense tracker built with Bun + Hono (API) and React bundled with Bun (web app). Import credit-card statement PDFs (BPI and UnionBank parsers, password-protected PDFs supported) or enter transactions manually. Amounts are stored in minor units (centavos); all currency is PHP.

## Quick Start (Bun)

From the repo root, install dependencies and start the API and web dev server together:

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000 (or the URL printed on startup). The Bun web dev
server proxies `/api` to the API server on port 3020 by default.

## Production with Bun

```bash
bun run build
bun run start
```

Open http://localhost:3020. Bun serves both the built UI and the API.
`GET /api/health` returns `{"ok":true}`.

Both `bun run dev` and `bun run start` build the Rust statement decoder
with Cargo (Rust 1.97+). For a Bun-only setup, run either command with
`EXPENSE_CP037_MODE=js` to use the TypeScript decoder without Cargo.

## Optional: Docker Compose

```bash
docker compose up -d --build
```

The default host port is 3020. Data persists in the named volume
`expense-data` mounted at `/data`.

## Configuration

- `PORT` — API listen port (default `3020`)
- `WEB_PORT` — Web dev server listen port (default `3000`)
- `DATA_DIR` — Directory for `app.db` (default `./data`)
- `WEB_DIR` — Static web assets path (default `./web/dist`; relative paths work)
- `ALLOW_SIGNUP` — Set to `0` to disable user registration; any other value allows it
- `COOKIE_SECURE` — Set to `1` to mark the session cookie `Secure`; needed behind HTTPS
- `EXPENSE_CP037_MODE` — Set to `js` to use the TypeScript statement decoder instead of the Rust addon

> **Tip:** Register the first user, then restart with `ALLOW_SIGNUP=0` to close signup.

## Project Layout

- `src/server/` — API server, routes, and parsers
  - `routes/documents.ts` — document upload/list/delete endpoints
  - `routes/transactions.ts` — transaction CRUD, summary, categories
  - `parsers/bpi.ts` — BPI PDF statement parser
  - `parsers/unionbank.ts` — UnionBank PDF statement parser
  - `main.ts` — entry point
- `web/` — React frontend bundled with Bun
- `Dockerfile` — container image definition
- `docker-compose.yml` — compose configuration

## API Routes

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- **Transactions** (authenticated): `GET /api/private/transactions`, `GET /api/private/transactions/summary`, `GET /api/private/transactions/categories`, `POST /api/private/transactions` (manual entry)
- **Documents** (authenticated): `POST /api/private/documents` (multipart upload, `file` + optional `password`), `GET /api/private/documents`, `DELETE /api/private/documents/:id`

## Statement Import Notes

- Supported formats: BPI and UnionBank credit-card statement PDFs.
- Password-protected PDFs are supported — supply the password on upload.
- Wrong or missing password returns HTTP 423 with `{error:'password_required', wrong:bool}`.
- Re-uploading the same file returns HTTP 409 (`already_uploaded`).

## Statement performance

`bun scripts/profile-statements.ts 300 20` times extraction and parsing of a
synthetic 20-page UnionBank statement without reading local files or a database.
For a CPU profile with rust-anything and Node 24.2+:

```sh
rust-anything profile . --lang ts -- node scripts/profile-statements.ts 400 20
```

If Node does not write the profile from `NODE_OPTIONS`, pass the same flags
explicitly:

```sh
rust-anything profile . --lang ts -- bash -c '
  dir=${NODE_OPTIONS#*--cpu-prof-dir=\"}; dir=${dir%%\"*}
  unset NODE_OPTIONS
  exec node --cpu-prof --cpu-prof-dir="$dir" scripts/profile-statements.ts 400 20
'
```

The baseline profile spent most of its time outside app code, chiefly in PDF.js.
CP037 decoding was a hot app-owned loop. Plain statements now skip decoding
entirely; when needed, the Rust addon decodes the document in one call.
See [the decoder README](rust/statement-cp037/README.md) for build and parity checks.

## Testing & Build

```bash
# Run tests
bun test

# Typecheck server and web app
bun run typecheck

# Lint the web app
bun run lint

# Build the web app (outputs web/dist)
bun run build
```
