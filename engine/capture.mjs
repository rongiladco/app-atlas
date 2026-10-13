// Captures scenarios from the REAL running app into out/frames.json (DOM + the CSS it rendered with + images, or a video).
// Default: only scenarios that are new or stale. --all, --only a,b,c* , --prune, --shots, --base URL.
import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { playwright, loadApp, status, sourceFiles, scenarioHash, readJson, writeLock, globRe } from "./lib.mjs";
const { chromium } = playwright;

// What a snapshot is: the app's DOM plus every stylesheet it injected (CSS-in-JS and react-native-web build CSS at runtime).
const SNAP = () => {
  document.querySelectorAll("canvas").forEach((c) => {
    try { const img = document.createElement("img"); img.src = c.toDataURL("image/png"); img.className = c.className; img.setAttribute("style", c.getAttribute("style") || ""); img.width = c.width; img.height = c.height; c.replaceWith(img); } catch {}
  });
  document.querySelectorAll("*").forEach((e) => { if (e.scrollLeft || e.scrollTop) { e.setAttribute("data-atlas-sl", String(e.scrollLeft)); e.setAttribute("data-atlas-st", String(e.scrollTop)); } });
  const parts = [...document.body.children].filter((c) => !["SCRIPT", "NOSCRIPT", "STYLE"].includes(c.tagName) && c.id !== "error-toast" && (c.id === "root" || c.innerHTML.trim()));
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const holder = document.createElement("div");
  parts.forEach((p) => holder.appendChild(p.cloneNode(true)));
  holder.querySelectorAll("script, noscript").forEach((n) => n.remove());
  return { body: holder.innerHTML, css, bodyClass: document.body.className, htmlClass: document.documentElement.className, width: innerWidth, height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight) };
};

export async function capture(app, args) {
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const { config: cfg, SCENARIOS, out, dir, appDir } = app;
  const BASE = opt("--base", cfg.baseUrl || "http://localhost:3000");
  const only = opt("--only", "").split(",").filter(Boolean).map((g) => globRe(g));
  const ALL = args.includes("--all"), SHOTS = args.includes("--shots"), PRUNE = args.includes("--prune");
  const VP = cfg.viewports;
  try { const r = await fetch(BASE); if (!r.ok && r.status >= 500) throw new Error(String(r.status)); }
  catch (e) { throw new Error(`dev server not reachable at ${BASE} (${e.message}). Start it (${cfg.previewName ? `the "${cfg.previewName}" dev server` : "the app's dev command"}) or pass --base.`); }

  const st = status(app);
  const need = new Set([...st.stale, ...st.missing]);
  const todo = SCENARIOS.filter((s) => (only.length ? only.some((r) => r.test(s.id)) : ALL || need.has(s.id)));
  if (!todo.length && !PRUNE) { console.log("nothing to capture — atlas is current."); return; }

  const KIT = cfg.kit;
  const kitFiles = (KIT?.files || []).map((f) => ({ from: join(dir, f.from), to: join(appDir, f.to) }));
  const cleanup = () => kitFiles.forEach((f) => { try { rmSync(f.to, { force: true }); } catch {} });
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(1); });
  if (todo.some((s) => s.kit) && kitFiles.length) { kitFiles.forEach((f) => copyFileSync(f.from, f.to)); await new Promise((r) => setTimeout(r, KIT.warmupMs ?? 6000)); }

  const assets = new Map();
  const browser = await chromium.launch();
  const expandScrollers = async (page) => {
    for (let i = 0; i < 4; i++) {
      const extra = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("*")].filter((e) => ["auto", "scroll"].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).map((e) => e.scrollHeight - e.clientHeight)));
      if (!extra) break;
      const cur = page.viewportSize();
      await page.setViewportSize({ width: cur.width, height: cur.height + extra });
      await page.waitForTimeout(500);
    }
  };

  async function runOne(sc) {
    const vp = VP[sc.vp || "m"];
    const crisp = sc.video || sc.raster;
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: crisp ? 1 : 0.5,
      reducedMotion: sc.motion || sc.video ? "no-preference" : "reduce",
      ...(cfg.colorScheme ? { colorScheme: cfg.colorScheme } : {}),
      ...(sc.video ? { recordVideo: { dir: join(out, "vid"), size: { width: vp.w, height: vp.h } } } : {}),
    });
    const at = sc.at || cfg.fixedTime;
    if (at) { try { await ctx.clock.setFixedTime(new Date(at)); } catch {} }
    // Persistent state is seeded before any page script runs. storage(sc) -> { key: value } (null = a brand-new visitor).
    const seed = cfg.storage ? cfg.storage(sc) : null;
    if (cfg.storage) await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("__atlas")) { localStorage.clear(); if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); sessionStorage.setItem("__atlas", "1"); } } catch {} }, seed);
    if (cfg.prepare) await cfg.prepare(ctx, sc); // anything else: cookies, route mocks, init scripts
    ctx.on("response", async (r) => {
      try {
        const u = r.url();
        if (assets.has(u) || r.status() !== 200) return;
        const type = r.headers()["content-type"] || "";
        if (!type.startsWith("image/")) return;
        assets.set(u, `data:${type.split(";")[0]};base64,${(await r.body()).toString("base64")}`);
      } catch {}
    });
    const page = await ctx.newPage();
    const tPage = Date.now();
    let tMark = 0;
    const mark = () => { tMark = Date.now(); };
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      page.setDefaultTimeout(25000);
      let route = sc.kit ? KIT.route(sc.kit, sc.q || "") : sc.route || "/";
      if (sc.url) { // a standalone sheet (mock photos...) kept as a picture of one element
        await page.goto(`${BASE}${sc.url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(sc.ready || "body[data-ready]", { timeout: 25000 });
        const buf = await page.locator(sc.shotSel).first().screenshot({ type: "jpeg", quality: 86 });
        return { id: sc.id, page: sc.page, title: sc.title, note: sc.note || "", recipe: sc.recipe || "", route: sc.url, vp: "m", kind: "img", src: "data:image/jpeg;base64," + buf.toString("base64"), width: sc.w, height: sc.h, errors };
      }
      if (cfg.navigate && !sc.kit) route = (await cfg.navigate(page, sc, { BASE, mark, vp })) || route; // apps that need a two-phase boot (seed through their own services, then reload)
      else {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90000 });
        if (!sc.kit) await page.waitForSelector(cfg.rootSelector || "#root > *, #app > *, body > *", { timeout: 60000 });
        if (sc.kit) { const r = KIT.ready || "[data-kit-ready]"; if (/^window\./.test(r)) await page.waitForFunction(r, null, { timeout: 30000 }); else await page.waitForSelector(r, { timeout: 30000 }); mark(); }
        await page.waitForTimeout(sc.settle ?? 900);
      }
      if (sc.steps) await sc.steps(page, { vp, mark });
      if (sc.expand) await expandScrollers(page);
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.waitForTimeout(sc.wait ?? 500);
      const base = { id: sc.id, page: sc.page, title: sc.title, note: sc.note || "", recipe: sc.recipe || "", route, vp: sc.vp || "m", errors };
      if (sc.video) {
        if (!tMark) mark();
        const D = sc.duration || 3000;
        await page.waitForTimeout(D * 0.45);
        const poster = (await page.screenshot({ type: "jpeg", quality: 72 })).toString("base64");
        await page.waitForTimeout(D * 0.55 + 250);
        const vid = page.video();
        await page.close();
        const src = await vid.path();
        const mp4 = src.replace(/\.webm$/, ".mp4");
        const ss = Math.max(0, (tMark - tPage) / 1000 - 0.2);
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", ss.toFixed(2), "-i", src, "-t", (D / 1000 + 0.3).toFixed(2), "-an", "-vf", `fps=25,scale=${vp.w}:${vp.h}:flags=lanczos`, "-c:v", "libx264", "-profile:v", "main", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
        const data = readFileSync(mp4).toString("base64");
        return { ...base, kind: "video", src: "data:video/mp4;base64," + data, poster: "data:image/jpeg;base64," + poster, width: vp.w, height: vp.h, bytes: data.length };
      }
      if (sc.raster) {
        const buf = await page.screenshot({ type: "jpeg", quality: 84 });
        return { ...base, kind: "img", src: "data:image/jpeg;base64," + buf.toString("base64"), width: vp.w, height: vp.h };
      }
      if (SHOTS) await page.screenshot({ path: join(out, "shots", `${sc.id}.png`), fullPage: true });
      const h = await page.evaluate(() => Math.max(innerHeight, document.documentElement.scrollHeight, document.body.scrollHeight));
      const poster = (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true, clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(h, 1500) } })).toString("base64");
      const snap = await page.evaluate(SNAP);
      return { ...base, poster: "data:image/jpeg;base64," + poster, ...snap };
    } finally { await ctx.close(); }
  }

  mkdirSync(join(out, "vid"), { recursive: true });
  const files = sourceFiles(app);
  const lock = readJson(app.lockFile, { scenarios: {} });
  const frames = [], failures = [];
  for (const sc of todo) {
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      try {
        const f = await runOne(sc);
        frames.push(f);
        lock.scenarios[sc.id] = { hash: scenarioHash(app, sc, files), capturedAt: new Date().toISOString().slice(0, 10) };
        done = true;
        console.log(`ok   ${sc.id.padEnd(34)} ${f.width}x${f.height}${f.bytes ? "  video " + Math.round((f.bytes * 0.75) / 1024) + " KB" : ""}${f.errors.length ? "  PAGEERRORS: " + f.errors.join(" | ").slice(0, 120) : ""}`);
      } catch (e) {
        if (attempt === 2) { failures.push(sc.id); console.log(`FAIL ${sc.id.padEnd(34)} ${String(e).split("\n")[0].slice(0, 150)}`); }
      }
    }
  }
  await browser.close();
  cleanup();

  // stylesheets are deduplicated by hash; the css of a page is whatever it rendered
  const cssFile = join(out, "css.json"), assetFile = join(out, "assets.json"), file = join(out, "frames.json");
  const cssStore = readJson(cssFile, {});
  for (const f of frames) if (f.css) { const h = createHash("md5").update(f.css).digest("hex").slice(0, 10); cssStore[h] = f.css; f.cssId = h; delete f.css; }
  writeFileSync(cssFile, JSON.stringify(cssStore));
  writeFileSync(assetFile, JSON.stringify({ ...readJson(assetFile, {}), ...Object.fromEntries(assets) }));
  const ids = new Set(SCENARIOS.map((s) => s.id));
  let all = [...readJson(file, []).filter((f) => !frames.some((n) => n.id === f.id)), ...frames];
  if (PRUNE) { all = all.filter((f) => ids.has(f.id)); for (const k of Object.keys(lock.scenarios)) if (!ids.has(k)) delete lock.scenarios[k]; }
  writeFileSync(file, JSON.stringify(all));
  writeLock(app, lock);
  console.log(`\n${frames.length} captured, ${failures.length} failed${PRUNE ? ", pruned removed scenarios" : ""} -> out/frames.json (${all.length} frames)`);
  if (failures.length) process.exitCode = 1;
}
