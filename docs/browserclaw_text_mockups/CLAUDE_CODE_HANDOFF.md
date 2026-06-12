# Claude Code Handoff Instructions

Use this package in this priority order:

1. `BROWSERCLAW_TEXT_MOCKUPS.md`
   - Canonical page layout, page purpose, and component structure.
2. `BROWSERCLAW_UI_SPEC.md`
   - App architecture, data ownership, route behavior, storage/security requirements.
3. `BROWSERCLAW_UI_TODO.md`
   - Implementation sequence.
4. `design_tokens.json`
   - Visual design constants.
5. `svg/*.svg` and `png_reference/*.png`
   - Visual references only.

Important implementation rule:

Do not implement the SVGs as static images. Build real React components that match the described layout and behavior.

Security rule:

Never put decrypted API keys or OAuth tokens in Redux state, localStorage, logs, audit events, or screenshots. Use an in-memory SecretVault.
