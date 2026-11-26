# Statement CP037 Decoder

Optional N-API native addon that decodes EBCDIC CP037 statement text in one call while preserving JavaScript UTF-16 code-unit semantics (including lone surrogates). PDF extraction, bank parsing, and encoding detection remain in TypeScript (`src/server/parsers/statement-encoding.ts`).

## Building Locally

Requires Rust `1.97+` (`cargo`) and Bun:

```bash
bun run build:native
bun test src/server/parsers/statement-encoding.test.ts
```

Or build the crate directly with Cargo:

```bash
cargo build --release --locked --manifest-path rust/statement-cp037/Cargo.toml
```

## JS Fallback & Docker Runtime

- The server automatically falls back to the pure TypeScript implementation (`src/server/parsers/cp037.ts`) when `statement_cp037.node` is not built or when `EXPENSE_CP037_MODE=js` is set.
- The production `oven/bun:1-alpine` Docker image runs with `EXPENSE_CP037_MODE=js` so it stays small and builds cleanly across `linux/amd64` and `linux/arm64` without a Rust/musl native build stage.
