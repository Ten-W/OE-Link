# Development Status

Version `0.5.37` is feature complete for the current OE Link scope. Future work should be driven by reproduced defects or explicit new requirements; no speculative backlog is maintained here.

Explicitly deferred:

- Detect local `.library` folders without requiring Eagle or OE Link Helper to be running; retain the precise Helper lookup, then use a bounded filesystem fallback beyond only the first directory level.
- Render the WebDAV address field with the same Obsidian input style as the username and password fields while retaining URL-oriented input behavior.
- Add a cloud-mode image command for downloading the Eagle original through the mobile long-press and desktop context menus, using the system save/share flow without modifying Obsidian's native image viewer.
