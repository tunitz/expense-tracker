# CLAUDE.md

Read and follow [AGENTS.md](./AGENTS.md) for all work in this repository.

In particular:
- **Never commit or push directly to `main`.** Always create a `feature/<short-kebab-name>` branch and open a Pull Request targeting `main`.
- Follow Conventional Commits (`feat:`, `fix:`, `docs:`, etc.) because merges to `main` drive automatic SemVer tagging, GitHub Releases, and GHCR image publishing.
- Run `EXPENSE_CP037_MODE=js bun test`, `bun run typecheck`, `bun run lint`, and `bun run build` before opening a PR.
