# BrowserClaw Figma/SVG Handoff

This package contains SVG mockups and implementation docs for Claude Code.

## Contents

- `svg/*.svg` — self-contained SVG mockups suitable for Figma import.
- `png_reference/*.png` — original raster mockups for reference.
- `design_tokens.json` — colors, typography, spacing, layout values.
- `BROWSERCLAW_UI_SPEC.md` — comprehensive UI/app implementation spec.
- `BROWSERCLAW_UI_TODO.md` — phased implementation checklist.

## Figma Import

1. Open Figma.
2. Create a new design file.
3. Drag the SVG files from `svg/` into Figma.
4. Put each screen on its own Figma page or frame.
5. Use the SVGs as visual references.
6. Implement the UI as real React components, not by embedding the SVGs.

## Important

The SVGs embed high-fidelity raster mockups. They are intended for implementation reference and Figma handoff, not as production UI assets.
