---
name: app-atlas
description: "Builds and maintains an ATLAS of an app, site or product: a Figma-style canvas (one self-contained HTML file) with every screen, every state, the flows, the UI kit and the animations, captured from the real running code instead of drawn, with checks that fail when the atlas drifts from the product. Use at the start of a project (atlas-init) and after every change that adds, alters or removes a screen, state, flow or component (atlas-sync). Also use when asked for an atlas, all the screens in one place, a Figma-like overview, or whether the atlas is up to date."
---

# app-atlas — the living atlas of a product

A Figma file shows every screen, every state and the UI kit in one place. This skill gives an app the same thing, **built from the real app** so it cannot silently go stale: each frame is a snapshot of the running app's DOM + the CSS it actually rendered with, animations are recorded video, and the UI kit is the app's own components rendered by a harness route. Frames are live (hover/focus work for CSS), crisp at any zoom, and published as one private Artifact.

**Workflow:** whoever owns the design of the product (a designer, or an agent playing that role) creates the atlas at the start of a project (`atlas-init`) and updates it in the same change that touches the product (`atlas-sync`). A good team rule: a change does not merge unless `status` says `ATLAS CURRENT`, and developers report which screens/states/flows/components they added, changed or removed (`ATLAS IMPACT`) — the tool is the authority, the report is a cross-check.

## The accuracy contract (the point of this skill)

The atlas is only worth having if it is **never wrong**. Four mechanisms make drift a failure, not a surprise:

| Mechanism | What it catches |
|---|---|
| **Hash per scenario** (`atlas.lock.json`: the scenario definition + the source files it depends on, via the `impact` map) | Any code or scenario change → that frame is `STALE` until recaptured. No impact entry = depends on all source (safe, imprecise). |
| **Route coverage** (`routes` in config, discovered from the router files when possible) | A new screen with no scenario → `UNCOVERED ROUTE`. A scenario pointing at a deleted screen → `DEAD ROUTE`. |
| **Structure checks** | Scenario whose page isn't in `structure.mjs` (would vanish silently) → `ORPHAN`; flow referencing a missing frame → `BAD FLOW`; frame whose scenario was deleted → `REMOVED`; duplicate ids. |
| **`verify.mjs` content expectations** + generic checks (page errors, empty page, 404 look-alikes) | A captured state that doesn't show what its title promises (copy changed, route broke, state not reached). Expectations come from the app's own copy files. A deleted UI element a scenario's `steps` click also fails the capture itself. |

`node atlas.mjs status` exits 1 on any of these. `sync` runs capture → verify → build → status and exits 1 unless everything is clean.

## Change → atlas action (the maintenance rule)

| The change… | Do |
|---|---|
| adds a screen / route | new scenarios for it: default + every state in the design notes, on every viewport it differs on; add to a page in `structure.mjs`; add to a flow if it is on a journey |
| adds a state to an existing screen (empty, error, success, new variant…) | new scenario reaching it with `steps` (play the app like a user, never fake the DOM) |
| changes how something looks or behaves | nothing to author; `sync` recaptures the stale frames. **Update `note` if the rule the note states changed** |
| removes a screen / state / component | **delete its scenarios** (then `capture --prune`), remove from flows; `DEAD ROUTE` / `BAD FLOW` tell you what you missed |
| adds or changes a component or token | update the kit sheet (the harness) so every variant shows; `kit-*` frames go stale automatically |
| changes a flow (a new step, a different destination) | edit `FLOWS` in `structure.mjs` (steps or sitemap edges) |
| adds an animation / transition | a `video` scenario in "Moments" |
| changes only copy | `sync`; check `verify.mjs` expectations still hold (they read from the copy file) |
| touches no UI and no state (pure refactor, tests, docs) | `status` only; stale frames still need `sync` if the hash moved |

When unsure whether something moves a frame: run `status`. It is the authority, not your judgement.

## Layout in an app

```
<app>/product/atlas/
  atlas.config.mjs     how the engine talks to this app (baseUrl, storage seed, routes, impact map, kit)   [committed]
  scenarios.mjs        every state                                                                          [committed]
  structure.mjs        pages in the rail + flows                                                            [committed]
  verify.mjs           WANT: strings each state must show                                                   [committed]
  atlas.lock.json      per-scenario hash at capture time (small)                                             [committed]
  kit-route.tsx, helpers.mjs, sc-*.mjs ...   app-specific harness and helpers (optional)                    [committed]
  README.md            commands, Artifact link, routes deliberately excluded (with reasons)                [committed]
  out/                 frames.json, css.json, assets.json, vid/, atlas.artifact.html                       [gitignored]
```
The engine lives in this skill, once, and is never copied into apps: `<skill-dir>/engine/atlas.mjs`.

## Commands

```bash
ATLAS=<skill-dir>/engine/atlas.mjs
node $ATLAS init     <app>             # scaffold product/atlas/ (templates + .gitignore)
node $ATLAS status   <app>             # STALE / NEW / REMOVED / ORPHAN / DEAD+UNCOVERED ROUTE / BAD FLOW   (exit 1 if not clean)
node $ATLAS sync     <app>             # capture changed+new, prune removed, verify, build, status  — run after every change
node $ATLAS capture  <app> --all | --only id,glob*,... | --prune | --base URL | --shots
node $ATLAS verify   <app>
node $ATLAS build    <app>             # -> out/atlas.artifact.html (fragment for an Artifact-style host) + out/atlas.html (local)
node $ATLAS compare  <app> id1,id2     # PNG: running app vs atlas rendering, side by side
node $ATLAS rebaseline <app>           # after editing the impact map ONLY. Never after a code change: it hides staleness.
```
`<app>` = the app root (or its `product/atlas`). The dev server must be running (the app's dev command; `previewName` in the config is just a label for it); capture reaches it at `baseUrl` / `--base`. **Requirements:** Node 18+, Playwright (`npm i -D playwright && npx playwright install chromium`, or set `ATLAS_PLAYWRIGHT=/folder/with/node_modules`), and `ffmpeg` on the PATH (only for video scenarios).

## atlas-init (a new app, or one without an atlas)

1. Read the app's `CLAUDE.md`, any product notes, router, state/storage code. Pick the stack recipe in `references/adapters.md`.
2. `init`, then fill `atlas.config.mjs`: baseUrl/previewName, `storage` seeding from the app's **real data shapes**, `routes` (discover or list), `impact` map (src areas → scenario globs), fixedTime, `kit` if the app has a component library.
3. Inventory before capturing — write it down in `scenarios.mjs` comments or the README: every route × every state the product can be in (first run / returning / empty / loading / error / success / disabled / long content / locked / permission-denied …) × the viewports that differ. A state the code can reach but the atlas lacks is a bug in the atlas.
4. Write scenarios (see rules below), `structure.mjs` (pages: Flows, Screens…, Foundations, UI kit, Moments), `verify.mjs` expectations for as many as possible.
5. `sync`, then **look**: `compare` a few frames, open `out/atlas.html`, check mobile + desktop, hover, scroll positions. Fix glitches before publishing.
6. Share it: `out/atlas.html` opens locally; `out/atlas.artifact.html` is a fragment meant for an Artifact-style host (no doctype/head, inline scripts only, under 16 MB). Put the link in the README. Keep it private until the owner decides otherwise.

## atlas-sync (after any change to the app)

1. Read what changed (the diff, or the developer's `FILES CHANGED` + `ATLAS IMPACT`) and any design notes for the change.
2. Apply the change→action table: author/edit/delete scenarios, flows, kit, verify expectations.
3. Start the dev server, `sync <app>`. Fix failures (a failed capture = a step that no longer reaches the state: the UI changed or the scenario is wrong — find out which; never delete a scenario only to make it pass unless the state truly no longer exists).
4. Look at every new or changed frame (`compare` / `--shots`), not just the exit code.
5. Report: frames added/changed/removed (ids), the `status` output, and anything in the atlas that now contradicts the design notes. Republish the shared copy (same link).

## Writing scenarios — rules that keep it honest

- **Reach states by playing the app** (`steps(page)`: click, type, wait), seeded through real storage shapes or the app's own services. Never edit the DOM to fake a state. If the state can't be reached by a user, it isn't in the atlas.
- **Deterministic:** frozen clock (`fixedTime`), seeded data, `reducedMotion` default (end state). Randomness in the app → seed it or avoid.
- **Titles in product language** ("Empty inbox", "Wrong answer"), notes state the *rule* a designer needs (why, not what).
- **Viewports:** phone (m) and desktop (d) for every screen whose layout differs; kit sheets at k.
- **Scrollers:** screens with inner scrolling need `expand: true` (the viewport grows until nothing scrolls); scroll positions are restored per element.
- **Animations & hover:** CSS hover/focus are live in frames. JS-driven hover (e.g. react-native-web `Pressable`) is not → show it as a video. Transitions → `video` scenarios in "Moments".
- **Kit = real components**, called with different props by the harness route (copied into the app only while capturing, removed after). Never redraw a component.
- **Don't fake data that real users won't have**; do cover long text, empty data and the extremes.
- A page of ~10–15 frames reads well; split big screens by state group, not by viewport.

## Known limits (say so in the README, don't hide them)

JS-only interactions inside a frame don't run (frames are markup; videos show motion). State needing a live backend/push is stubbed via `prepare`. Fonts that the dev server serves from the network must be embeddable or fall back to system fonts. The Artifact viewer blocks iframes, which is why frames are shadow roots with flattened CSS — see `references/lessons.md` before changing the engine.

## References
- `references/adapters.md` — recipes per stack (Vite SPA, Expo/react-native-web, Next, static site), seeding, kit harness, impact maps.
- `references/lessons.md` — every glitch met while building this (what broke, why, how the engine handles it). Read before touching `engine/`.
- `templates/` — the files `init` scaffolds; `kit-route.example.tsx` — a minimal UI-kit harness to adapt.
