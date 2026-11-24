# Brief

**Question:** The Rust rewrite of the expense tracker is finished, but the app actually running on this machine is still an older build. The person asked to restart the app. Restart it on the current build, keep its data and access token, and verify the newest assistant tool is live.

**Purpose:** Make the running app match the finished Rust build so the assistant connection exposes the newest tools and fixes, without losing data or breaking configuration.

**Targets:**
- /home/tunitz/Projects/expense-tracker/

**Constraints:**
- Work in place; only project files plus the harness MCP config that holds the token
- Keep the Rust Axum/SQLite + React/Vite architecture
- The person explicitly asked to restart the app, so starting the app binary as a detached process is in scope this turn (no dev server, watcher or build loop)
- Do not touch Craft Anything records or the live database; preserve the existing token and categories

**Done when:** A fresh process on port 3020 runs the current binary; health and POST /mcp answer; tools/list includes update_transaction; categories and account are intact; rebuild_check passes.
