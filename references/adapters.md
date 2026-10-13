# Stack recipes

The engine needs from an app only: a URL that serves it, a way to put it in a given state, and its list of routes. Everything below is how to supply those.

## Seeding state (`storage` + scenario `save`)
Persistent state lives in localStorage for almost every app here. `storage(sc)` returns `{ key: value }` written before any app script runs (once per context; `null` = brand-new visitor). Build `save` objects with the app's **real shapes**:
- **Vite SPA with service modules:** don't hand-write JSON. Add a small browser-side helper (`window.__atlas`) that imports the app's own services from the dev server (`/src/services/*.ts`) and builds state through them, so every seeded state is valid by the app's validators. Run it from a scenario `setup` via `prepare`/`steps` (the function is serialized into the page: it cannot reference Node variables).
- **Expo / react-native-web:** AsyncStorage → localStorage under one key; seed that key directly. Read ids from the app's own content files so seeds can't drift.
- **Server-backed apps:** `prepare(ctx, sc)` → `ctx.route("**/api/**", …)` with fixtures, cookies via `ctx.addCookies`. Fixtures must come from the app's own mocks/types where they exist.
- **Time:** `fixedTime` freezes the clock; scenario `at` overrides it.

## Routes (`routes`)
- `{ discover: "expo-router" }` — files under `app/` (layouts and `+` files skipped, `(groups)` dropped, `[id]` → `:id`). Exclude the harness with `ignoreRoutes: ["/atlas-kit"]`.
- `{ discover: "next-app" | "next-pages" | "static-html" }` — same idea for Next and plain `.html` sites.
- Hash-router SPA: `{ discover: "grep", file: "src/router.ts", pattern: "…\\('([^']+)'" }` or an explicit array. A hand-kept array is fine, but then adding a route means editing it in the same change — put that in the stack's README.
- A dynamic route needs one scenario per **meaningfully different** instance, with `covers: ["/lesson/:id"]` if its concrete path wouldn't match.

## Impact map (`impact`)
```js
impact: [
  { files: ["src/checkout/**", "content/**"], scenarios: ["checkout-*", "kit-forms"] },
  { files: ["src/theme.ts", "src/ui/**", "app/**"], scenarios: ["*"] },
]
```
A scenario depends on the union of files from every entry whose scenario globs match its id; none → all source. Err on the side of too broad: a missing dependency means a stale frame goes unnoticed. After editing the map run `rebaseline` once (it records the new hashes without recapturing — acceptable only because no code changed).

## UI kit harness
A route that exists **only while capturing**: the engine copies `product/atlas/kit-route.tsx` (or .html + .ts for Vite) into the app (`kit.files`), waits for `[data-kit-ready]`, captures each `?sheet=…`, then deletes the copy (and `.gitignore` lists it). Rules:
- It imports and calls the app's real components with varied props (sizes, states, content lengths, RTL). No copies.
- Sheets: Foundations (colour with contrast ratios of the pairs the UI really uses, type, space, shape/radius, depth, motion), Components (one sheet per family), Icons/illustrations.
- When a component or token is added/changed, extend its sheet in the same change.
- Vite apps: `kit.html` + `kit.ts` at project root (also removed after).
- RTL apps: set explicit row order for label/value pairs and keep hex codes and ratios in an LTR bidi isolate.

## Videos
`{ video: true, duration, steps: async (p, { mark }) => { …setup…; mark(); …the animated action… } }`. Only what happens after `mark()` is recorded. 25fps H.264, crf 27: ~30–100 KB per 3–8 s. Keep the total Artifact under 15 MB (build fails above).

## Per-stack notes
| Stack | CSS source | Hover | Notes |
|---|---|---|---|
| Vite / CSS files | `document.styleSheets` of the dev page | live | cleanest case |
| Expo + react-native-web | injected at runtime into `<style>` (captured the same way) | JS `Pressable` hover is **not** live → video | ScrollViews scroll internally → `expand: true`; system fonts unless the app bundles some |
| Next / React + CSS-in-JS | runtime-injected, captured the same way | CSS hover live | SSR content ok; wait for hydration (`settle`) |
| Static site | stylesheets as served | live | routes via `static-html` |
