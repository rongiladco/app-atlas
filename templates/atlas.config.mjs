// How the atlas talks to THIS app. Everything the engine cannot know. See references/adapters.md for the stack recipes.
export default {
  name: "My App",                       // shown on the canvas
  lang: "en",                           // lang of the app's content ("he" etc. — the frames render with it)
  frameBg: "#ffffff",                   // the app's page background, for frames shorter than their box
  baseUrl: "http://localhost:3000",     // the dev server (override with --base)
  previewName: "my-app",                // a label for the dev-server command that starts it

  // Frames per screen size. m = phone, d = desktop, k = UI-kit sheets. Add more if the app has more breakpoints.
  viewports: { m: { w: 390, h: 844 }, d: { w: 1280, h: 800 }, k: { w: 1100, h: 800 } },

  // Persistent state, seeded before the app loads: scenario -> { localStorageKey: value } | null (a brand-new visitor).
  // Use the scenario's own `save` field, built from the app's real data shapes. Use `prepare` for cookies, mocks, init scripts.
  storage: (sc) => (sc.save ? { "my-app.save": sc.save } : null),
  // prepare: async (ctx, sc) => { await ctx.addCookies([...]); await ctx.route("**/api/**", ...); },
  fixedTime: "2026-01-12T08:30:00",     // freeze the clock so a capture is repeatable ("Good morning" must not drift)

  // THE ROUTES OF THE APP — how the atlas proves it shows every screen. One of:
  //   routes: ["/", "/settings", "/item/:id"]                         (always works)
  //   routes: { discover: "expo-router" | "next-app" | "next-pages" | "static-html" }
  //   routes: { discover: "grep", file: "src/router.ts", pattern: "route\\('([^']+)'" }   (hash-router SPAs)
  routes: ["/"],
  ignoreRoutes: [],                     // routes deliberately not in the atlas (each needs a reason in README.md)

  // Which source files change which scenarios. A scenario with no entry depends on ALL source (always safe, just less precise).
  // Precision matters: it is what lets `status` say "only these 6 frames are stale" after a change.
  sourceDirs: ["src"],
  impact: [
    // { files: ["src/screens/home/**", "src/components/Card*"], scenarios: ["home-*"] },
  ],

  // The UI kit: a harness route that renders the app's REAL components in every variant (see references/adapters.md §kit).
  // kit: { files: [{ from: "kit-route.tsx", to: "app/atlas-kit.tsx" }], route: (sheet, q) => `/atlas-kit?sheet=${sheet}${q}`, ready: "[data-kit-ready]" },
};
