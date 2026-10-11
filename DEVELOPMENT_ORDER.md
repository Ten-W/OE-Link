# Development Status

See `manifest.json` for the current version and `CHANGELOG.md` for completed changes. The old deferred items have shipped; no speculative backlog is maintained here.

Before changes, preserve a versioned backup. Edit `main.source.js`, `mobile.js` and `lib/`, not the generated `desktop.js` or `main.js`. Run `npm run build` and `npm run verify` before copying a release into Obsidian. Verification scripts run in separate processes to isolate mocks and wait for asynchronous checks.
