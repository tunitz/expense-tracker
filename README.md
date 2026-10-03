# Expense Tracker

A personal expense tracker built with Bun + Hono (API) and React/Vite (web app). Import credit-card statement PDFs (BPI and UnionBank parsers, password-protected PDFs supported) or enter transactions manually. Amounts are stored in minor units (centavos); all currency is PHP.

## Quick Start (Docker)

```bash
docker compose up -d --build
```

The API listens on port 3020 (host port from the `PORT` env var). Data persists in the named volume `expense-data` mounted at `/data`. Health check: `GET /api/health` returns `{"ok":true}`.

## Local Development

```bash
# Install dependencies (root + web/)
bun install
cd web && bun install && cd ..

# Start the API server (default :3020)
bun run src/server/main.ts

# In a separate terminal, start the web dev server
cd web && bunx vite
```

The web dev server proxies `/api` requests to `http://localhost:3020`.

## Configuration

- `PORT` — API listen port (default `3020`)
- `DATA_DIR` — Directory for `app.db` (default `./data`)
- `WEB_DIR` — Static web assets path (default `./web/dist`; relative paths work)
- `ALLOW_SIGNUP` — Set to `0` to disable user registration; any other value allows it
- `COOKIE_SECURE` — Set to `1` to mark the session cookie `Secure`; needed behind HTTPS

> **Tip:** Register the first user, then restart with `ALLOW_SIGNUP=0` to close signup.

## Project Layout

- `src/server/` — API server, routes, and parsers
  - `routes/documents.ts` — document upload/list/delete endpoints
  - `routes/transactions.ts` — transaction CRUD, summary, categories
  - `parsers/bpi.ts` — BPI PDF statement parser
  - `parsers/unionbank.ts` — UnionBank PDF statement parser
  - `main.ts` — entry point
- `web/` — Vite React frontend (own `package.json`)
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

## Testing & Build

```bash
# Run tests (root)
bun test

# Typecheck the web app
cd web && bunx tsc -b

# Build the web app (outputs web/dist)
cd web && bunx vite build
```
