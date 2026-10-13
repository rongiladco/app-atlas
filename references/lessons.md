# Lessons from building the engine (first on a Vite SPA, then on an Expo/react-native-web app)

Read before changing `engine/`. Each line: symptom → cause → what the engine does.

- **Blurry frames when zoomed** → frames were screenshots. → Frames are real DOM + CSS (vector, selectable); only videos/posters are raster.
- **Artifact viewer shows no iframes** → can't isolate each frame's viewport. → Frames are **shadow roots** with adoptedStyleSheets (fallback `<style>`), and `flatten.mjs` resolves the viewport: static media queries (width/height/orientation) are evaluated with the browser's own `matchMedia` and flattened; `vh/dvh/vw` → `calc(var(--fvh|--fvw) …)`; `html/:root` → `:host`, `body` → `.fbody`. **Each frame size needs its own flattened stylesheet** (cache key `cssId:vp`; the kit sheets once got the phone's flattening).
- **Duplicated/oversized images in the Artifact gallery** → platform reset `img{max-width:100%}` fights `transform: scale`. → `max-width:none` on img/video/frame hosts.
- **Same image embedded dozens of times** → each frame inlined its data URI. → Assets become tokens `⟦A#⟧`, embedded once; the DOM holds relative paths, so tokens match absolute URL, relative path, and their HTML-escaped forms.
- **Flow arrows invisible** → SVG created with `createElement` instead of `createElementNS`.
- **Mojibake locally** → the Artifact fragment has no `<meta charset>`. → `build` writes both `atlas.artifact.html` (fragment) and `atlas.html` (wrapped, charset).
- **A scenario's setup function threw "X is not defined"** → functions serialized into the page can't see Node variables. → seed helpers live inside the page (`window.__atlas`) or in `storage()`.
- **Video frames crashed the build** → they have no body; build skips body handling for `kind: video`.
- **Notes lied** ("unavailable" when only headless push was missing) → notes/titles come from the scenario files at build time, so fixing text never needs a recapture; and notes must be checked against the state they describe.
- **Scroll positions lost** → they live on elements, not markup. → capture stores `data-atlas-sl/st`, the shell restores them.
- **react-native-web ScrollViews cut the page** → `expand: true` grows the viewport until no element scrolls.
- **An "open a locked item" scenario was impossible** → the control is `disabled`; the app was right, the scenario wrong. A scenario must be a path a user can take.
- **A state not reachable by deep link** (e.g. "returning user") → reach it the way a user does (via the screen that links to it), not by URL.
- **Race between navigation and seeding** → seeding runs in `addInitScript` guarded by a sessionStorage flag so a reload inside `steps` doesn't reset the state.
- **Dev server dies during long runs** → restart it; capture checks reachability first and says so.
- **Browser pane can't open `file://` outside the cwd** → view atlas pages with `compare` or Playwright screenshots.
- **YAML descriptions with colons** in agent/skill front matter must be quoted.
- **Hover:** CSS `:hover` is live inside a frame (CSS is live); JS hover is not.
- **Videos:** record only after `mark()`; the poster is taken mid-way; `-ss` trims the setup.
- **Artifact size:** 16 MB hard limit; videos ≈ 30–100 KB each at crf 27; ~100 frames ≈ 6–8 MB.
