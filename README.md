# app-atlas

A skill for Claude Code (and any agent or human who can run Node) that builds a **living atlas** of a product: one self-contained HTML canvas, in the style of a Figma file, with every screen, every state, the user flows, the UI kit and the animations.

The difference from a hand-made design file: **every frame is captured from the running app** (its real DOM and the CSS it actually rendered with; animations as recorded video), so it is crisp at any zoom, hover/focus work, and nothing can be forgotten silently:

- each scenario is hashed with the source files it depends on, so a code change marks exactly the frames it affects as `STALE`;
- the app's routes are compared with the scenarios: a screen without a scenario is `UNCOVERED ROUTE`, a scenario for a deleted screen is `DEAD ROUTE`;
- structure checks (orphan scenarios, broken flows, removed screens) and per-scenario content expectations;
- `atlas.mjs sync` captures only what changed, prunes what was removed, verifies, builds, and exits non-zero unless the atlas is current — easy to wire into a review gate or CI.

## Install

Copy this folder into your Claude Code skills (`~/.claude/skills/app-atlas` or `<project>/.claude/skills/app-atlas`), then:

```bash
npm i -D playwright && npx playwright install chromium   # in the app, once
node <skill-dir>/engine/atlas.mjs init <app-dir>         # scaffolds <app>/product/atlas/
# fill product/atlas/atlas.config.mjs, write scenarios, start the dev server, then:
node <skill-dir>/engine/atlas.mjs sync <app-dir>
```

Needs Node 18+, Playwright, and `ffmpeg` (only for video scenarios). Works with any web stack that has a dev server: Vite/React/Vue, Next, static sites, Expo/react-native-web (recipes in `references/adapters.md`).

## What is in here

| | |
|---|---|
| `SKILL.md` | The skill: when to use it, the accuracy contract, the change → atlas-action table, init/sync procedures, scenario-writing rules |
| `engine/` | The CLI (`atlas.mjs`) and its parts: capture, CSS flattening for fixed-size frames, build, verify, compare, status |
| `templates/` | What `init` scaffolds (config, scenarios, structure, verify, README) and a minimal UI-kit harness |
| `references/` | Stack recipes and a log of pitfalls (read before changing the engine) |

## How the frames work

An iframe per frame would be simplest, but many hosts (including the Artifact viewers of some tools) block iframes. So each frame is a **shadow root** holding the captured markup, with the app's stylesheet *flattened* for that frame's size: width/height media queries are evaluated with the browser's own `matchMedia`, `vh/dvh/vw` units become `calc()` over per-frame variables, `:root`/`html` become `:host`, `body` becomes a wrapper class. Images are embedded once and referenced by token.

## Limits

JS-only interactions inside a frame do not run (frames are markup; use video scenarios for motion). State that needs a live backend must be stubbed in `prepare`. The output must stay under ~15 MB for hosts with a 16 MB limit.

## License

MIT.
