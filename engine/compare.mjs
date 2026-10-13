// Renders chosen frames the way the atlas does (shadow root + flattened CSS + embedded images) and saves a PNG next to the
// poster captured from the running app, so the two can be compared by eye:  node atlas.mjs compare <app> id1,id2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playwright } from "./lib.mjs";

export async function compare(app, ids) {
  const html = readFileSync(join(app.out, "atlas.artifact.html"), "utf8");
  const browser = await playwright.chromium.launch();
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
    await page.setContent(`<!doctype html><meta charset=utf-8><body>${html}</body>`, { waitUntil: "domcontentloaded" });
    const r = await page.evaluate(async ({ id, vps, lang }) => {
      const f = ATLAS.FRAMES.find((x) => x.id === id);
      if (!f || f.kind) return null;
      document.body.innerHTML = '<div id="t" style="display:flex;gap:24px;padding:12px;background:#ddd"></div>';
      const fill = (t) => t.replace(/⟦(A\d+)⟧/g, (m, k) => ATLAS.ASSETS[k] || m);
      const sheet = (t) => { const s = new CSSStyleSheet(); s.replaceSync(t); return s; };
      const host = document.createElement("div");
      host.style.cssText = `width:${f.width}px;height:${Math.min(f.height, 1500)}px;--fvw:${f.width}px;--fvh:${vps[f.vp].h}px;overflow:hidden;position:relative`;
      const root = host.attachShadow({ mode: "open" });
      root.adoptedStyleSheets = [sheet(fill(ATLAS.CSS[f.cssId + ":" + f.vp] || "")), sheet(":host{display:block;overflow:hidden;background:" + ATLAS.META.frameBg + ";contain:layout paint style}.fbody{min-height:100%}")];
      root.innerHTML = `<div class="fbody ${f.bodyClass}" lang="${lang}">${fill(f.body)}</div>`;
      const img = document.createElement("img"); img.src = f.poster; img.style.cssText = `width:${f.width}px;height:auto;align-self:flex-start;border:1px solid #999`;
      document.getElementById("t").append(img, host);
      await new Promise((r) => setTimeout(r, 700));
      return { w: f.width * 2 + 60, h: Math.min(f.height, 1500) + 30 };
    }, { id, vps: app.config.viewports, lang: app.config.lang });
    if (!r) { console.log(id, "skipped"); await page.close(); continue; }
    await page.screenshot({ path: join(app.out, "shots", `cmp-${id}.png`), clip: { x: 0, y: 0, width: r.w, height: Math.min(r.h, 1200) } });
    console.log(`wrote ${join(app.out, "shots", "cmp-" + id + ".png")} (left: the running app, right: the atlas)`);
    await page.close();
  }
  await browser.close();
}
