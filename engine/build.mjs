// Assembles out/atlas.artifact.html (one self-contained fragment, for Artifact-style hosts) and out/atlas.html (opens locally).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { flattenCss } from "./flatten.mjs";
import { ENGINE, playwright, readJson } from "./lib.mjs";

export async function build(app) {
  const { config: cfg, SCENARIOS, PAGES, FLOWS, out, appDir } = app;
  const frames = readJson(join(out, "frames.json"), []);
  const cssStore = readJson(join(out, "css.json"), {});
  const assetStore = readJson(join(out, "assets.json"), {});
  // Titles, notes and page come from the scenario files, so editing text never needs a recapture.
  const byScenario = new Map(SCENARIOS.map((s) => [s.id, s]));
  for (const f of frames) { const s = byScenario.get(f.id); if (s) { f.title = s.title; f.note = s.note || ""; f.page = s.page; if (s.url) { f.width = s.w; f.height = s.h; } } }
  const known = new Set(PAGES.flatMap((g) => g.pages.map((p) => p.name)));
  const live = frames.filter((f) => known.has(f.page) && byScenario.has(f.id));
  const dropped = frames.length - live.length;
  if (dropped) console.log(`warning: ${dropped} captured frame(s) not shown (removed scenario or page missing from structure.mjs)`);
  const order = PAGES.flatMap((g) => g.pages.map((p) => p.name));
  live.sort((a, b) => order.indexOf(a.page) - order.indexOf(b.page));

  // Every image the app asked for becomes one shared token, embedded once. URLs appear raw, HTML-escaped and CSS-quoted.
  const tokenOf = new Map(), ASSETS = {};
  const esc = (s) => s.replace(/&/g, "&amp;");
  const urls = Object.keys(assetStore).sort((a, b) => b.length - a.length);
  const swap = (text) => {
    for (const u of urls) {
      const rel = u.replace(/^https?:\/\/[^/]+/, "");
      for (const v of new Set([u, esc(u), rel, esc(rel)])) {
        if (!text.includes(v)) continue;
        if (!tokenOf.has(u)) { const t = "A" + tokenOf.size; tokenOf.set(u, t); ASSETS[t] = assetStore[u]; }
        text = text.split(v).join("⟦" + tokenOf.get(u) + "⟧");
      }
    }
    return text;
  };
  for (const f of live) if (f.body) f.body = swap(f.body);
  for (const k of Object.keys(cssStore)) cssStore[k] = swap(cssStore[k]);

  const need = new Set(live.filter((f) => f.cssId).map((f) => `${f.cssId}:${f.vp}`));
  const browser = await playwright.chromium.launch();
  const CSS = {};
  for (const key of need) { const [id, vp] = key.split(":"); CSS[key] = await flattenCss(browser, cssStore[id], cfg.viewports[vp].w, cfg.viewports[vp].h); }
  await browser.close();

  let commit = "unversioned";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: appDir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  const META = { label: `${cfg.name} @ ${commit} · ${live.length} states · captured from the running app`, frameBg: cfg.frameBg, lang: cfg.lang };
  const data = { FRAMES: live, PAGES, FLOWS, CSS, ASSETS, META };
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const json = JSON.stringify(data).split("<").join("\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
  const shell = readFileSync(join(ENGINE, "shell.html"), "utf8").split("__NAME__").join(cfg.name);
  const html = (cfg.headHtml || "") + shell.split("/*__DATA__*/").join(`const ATLAS = ${json};`);
  writeFileSync(join(out, "atlas.artifact.html"), html);
  writeFileSync(join(out, "atlas.html"), `<!doctype html><html lang="${cfg.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`);
  const mb = html.length / 1024 / 1024;
  console.log(`built out/atlas.artifact.html: ${mb.toFixed(2)} MB, ${live.length} frames, ${Object.keys(CSS).length} stylesheets, ${Object.keys(ASSETS).length} images`);
  if (mb > 15) { console.log("ERROR: over the 16MB Artifact limit — shorten videos, drop duplicate states, or lower poster quality"); process.exitCode = 1; }
}
