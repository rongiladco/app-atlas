// Shared plumbing for the atlas engine: locating an app's atlas folder, loading its files, hashing sources,
// and computing what is stale. Everything app-specific lives in the app's product/atlas/ folder, never here.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { discoverRoutes } from "./routes.mjs";

export const ENGINE = dirname(fileURLToPath(import.meta.url));
// Playwright is resolved from (in order): $ATLAS_PLAYWRIGHT (a folder that contains node_modules/playwright), the current
// directory, the engine folder, or the global install. Install once with:  npm i -D playwright && npx playwright install chromium
export const playwright = (() => {
  const bases = [process.env.ATLAS_PLAYWRIGHT && join(process.env.ATLAS_PLAYWRIGHT, "/"), process.cwd() + "/", join(ENGINE, "/")].filter(Boolean);
  for (const base of bases) { try { return createRequire(base)("playwright"); } catch {} }
  throw new Error("Playwright not found. Run `npm i -D playwright && npx playwright install chromium` in the app (or set ATLAS_PLAYWRIGHT=/path/with/node_modules).");
})();

export const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
export const readJson = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d);
export const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\*\*$/g, (m) => (m === "**/" ? "\u0000" : "\u0001")).replace(/\*/g, "[^/]*").replace(/\u0000/g, "(?:.*/)?").replace(/\u0001/g, ".*") + "$");

export const DEFAULT_VIEWPORTS = { m: { w: 390, h: 844 }, d: { w: 1280, h: 800 }, k: { w: 1100, h: 800 } };

/** `target` may be the app root, or its product/atlas folder. */
export async function loadApp(target) {
  const t = resolve(target || process.cwd());
  const dir = existsSync(join(t, "atlas.config.mjs")) ? t : join(t, "product", "atlas");
  if (!existsSync(join(dir, "atlas.config.mjs"))) throw new Error(`no atlas.config.mjs in ${dir} — run: node atlas.mjs init ${t}`);
  const appDir = /[\\/]product[\\/]atlas$/.test(dir) ? resolve(dir, "..", "..") : resolve(dir, "..");
  const imp = (f) => import(pathToFileURL(join(dir, f)).href + "?t=" + Date.now());
  const config = { viewports: DEFAULT_VIEWPORTS, lang: "en", frameBg: "#ffffff", ...(await imp("atlas.config.mjs")).default };
  config.viewports = { ...DEFAULT_VIEWPORTS, ...config.viewports };
  const { SCENARIOS } = await imp("scenarios.mjs");
  const { PAGES, FLOWS } = await imp("structure.mjs");
  const out = join(dir, "out");
  mkdirSync(join(out, "shots"), { recursive: true });
  return { dir, appDir, out, config, SCENARIOS, PAGES, FLOWS, imp, lockFile: join(dir, "atlas.lock.json") };
}

// ---------- which source files the atlas depends on ----------
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".expo", ".next", "atlas", "product", ".cache", "out", "ios", "android", ".turbo", "coverage"]);
const DEFAULT_EXT = ["ts", "tsx", "js", "jsx", "mjs", "css", "scss", "html", "json", "vue", "svelte", "svg"];
export function sourceFiles(app) {
  const { appDir, config } = app;
  const ext = new Set(config.sourceExt || DEFAULT_EXT);
  const roots = (config.sourceDirs || ["src", "app", "components", "pages", "content", "public", "lib", "styles", "assets"]).filter((d) => existsSync(join(appDir, d)));
  const files = {};
  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); continue; }
      if (name === "atlas-kit.tsx" || !ext.has(name.split(".").pop())) continue;
      if (st.size > 2_000_000) continue;
      files[relative(appDir, p)] = sha(readFileSync(p));
    }
  };
  roots.forEach((r) => walk(join(appDir, r)));
  for (const f of config.extraSource || []) if (existsSync(join(appDir, f))) files[f] = sha(readFileSync(join(appDir, f)));
  for (const f of readdirSync(appDir)) if (/^(index\.html|vite\.config\.\w+|app\.json|tailwind\.config\.\w+)$/.test(f)) files[f] = sha(readFileSync(join(appDir, f)));
  return files;
}

/** A scenario depends on the files matched by the `impact` entries naming it; no entry means "everything". */
export function scenarioHash(app, sc, files) {
  const impact = app.config.impact || [];
  const hit = impact.filter((e) => (e.scenarios || []).some((g) => globRe(g.replace(/\*/g, "**")).test(sc.id) || globRe(g).test(sc.id)));
  const pats = hit.flatMap((e) => e.files).map(globRe);
  const dep = hit.length ? Object.keys(files).filter((f) => pats.some((r) => r.test(f))) : Object.keys(files);
  const def = JSON.stringify(sc, (k, v) => (typeof v === "function" ? String(v) : v));
  return sha(def + "\n" + dep.sort().map((f) => f + ":" + files[f]).join("\n"));
}

// ---------- status: what is out of date, missing, removed, orphaned ----------
export function status(app) {
  const { SCENARIOS, PAGES, FLOWS, config, out } = app;
  const lock = readJson(app.lockFile, { scenarios: {} });
  const frames = readJson(join(out, "frames.json"), []);
  const have = new Set(frames.map((f) => f.id));
  const files = sourceFiles(app);
  const ids = new Set(SCENARIOS.map((s) => s.id));
  const r = { stale: [], missing: [], removed: [], orphans: [], deadRoutes: [], uncoveredRoutes: [], badFlows: [], dupes: [], total: SCENARIOS.length };
  const seen = new Set();
  for (const s of SCENARIOS) {
    if (seen.has(s.id)) r.dupes.push(s.id);
    seen.add(s.id);
    if (!have.has(s.id)) { r.missing.push(s.id); continue; }
    const l = lock.scenarios[s.id];
    if (!l || l.hash !== scenarioHash(app, s, files)) r.stale.push(s.id);
  }
  r.removed = frames.map((f) => f.id).filter((id) => !ids.has(id));
  const pages = new Set(PAGES.flatMap((g) => g.pages.map((p) => p.name)));
  r.orphans = SCENARIOS.filter((s) => !pages.has(s.page)).map((s) => `${s.id} (page "${s.page}")`);
  const frameRefs = FLOWS.flatMap((f) => [...(f.steps || []).map((s) => s.frame), ...((f.graph && f.graph.nodes) || []).map((n) => n.frame)]);
  r.badFlows = [...new Set(frameRefs.filter((id) => !ids.has(id)))];
  // routes: every screen of the app must appear on the canvas, and no scenario may point at a screen that is gone
  const routes = discoverRoutes(config.routes, app.appDir);
  if (routes) {
    const ignore = (config.ignoreRoutes || []).map(globRe);
    const rx = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/:[\w-]+|\\\[[^\]]+\\\]/g, "[^/]+").replace(/\*/g, ".*") + "/?$");
    const real = routes.filter((p) => !ignore.some((g) => g.test(p)));
    const paths = SCENARIOS.filter((s) => !s.kit && !s.url && typeof s.route !== "function").map((s) => ({ id: s.id, path: (s.route || "/").split("?")[0].split("#").pop() || "/", covers: s.covers || [] }));
    for (const s of SCENARIOS) if (typeof s.route === "function") paths.push({ id: s.id, path: "\u0000", covers: s.covers || [] }); // computed routes cover only what `covers` names
    r.uncoveredRoutes = real.filter((p) => !paths.some((x) => x.covers.includes(p) || rx(p).test(x.path)));
    r.deadRoutes = paths.filter((x) => x.path !== "\u0000" && !real.some((p) => rx(p).test(x.path)) && !routes.some((p) => rx(p).test(x.path))).map((x) => `${x.id} -> ${x.path}`);
  }
  r.clean = !(r.stale.length + r.missing.length + r.removed.length + r.orphans.length + r.deadRoutes.length + r.uncoveredRoutes.length + r.badFlows.length + r.dupes.length);
  return r;
}

export function printStatus(r) {
  const row = (label, list, hint) => { if (list.length) console.log(`${label.padEnd(18)} ${list.length}  ${list.slice(0, 12).join(", ")}${list.length > 12 ? " …" : ""}\n${" ".repeat(18)} → ${hint}`); };
  row("STALE", r.stale, "source or scenario changed since capture: node atlas.mjs capture");
  row("NEW (no frame)", r.missing, "scenario has never been captured: node atlas.mjs capture");
  row("REMOVED", r.removed, "frame without a scenario (screen deleted?): node atlas.mjs capture --prune");
  row("ORPHAN", r.orphans, "scenario's page is not in structure.mjs, so it would be dropped from the canvas");
  row("DEAD ROUTE", r.deadRoutes, "scenario opens a route the app no longer has: remove or fix the scenario");
  row("UNCOVERED ROUTE", r.uncoveredRoutes, "a screen of the app is not in the atlas: add a scenario (or ignoreRoutes with a reason)");
  row("BAD FLOW", r.badFlows, "a flow in structure.mjs references a frame that does not exist");
  row("DUPLICATE ID", r.dupes, "two scenarios share an id");
  console.log(r.clean ? `ATLAS CURRENT — ${r.total} scenarios, nothing stale.` : `ATLAS OUT OF DATE (${r.total} scenarios).`);
}
export const writeLock = (app, lock) => writeFileSync(app.lockFile, JSON.stringify(lock, null, 1) + "\n");
