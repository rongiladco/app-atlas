// Every captured state must show what its title promises. Generic checks always run; the app adds expectations in
// product/atlas/verify.mjs:  export const WANT = { "scenario-id": ["text that must appear", ...] };  (optional: export function EXTRA(frames) -> string[])
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readJson } from "./lib.mjs";

export async function verify(app) {
  const frames = readJson(join(app.out, "frames.json"), []);
  const mod = existsSync(join(app.dir, "verify.mjs")) ? await app.imp("verify.mjs") : {};
  const WANT = mod.WANT || {};
  const text = (f) => ((f.body || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ") + " " + (f.body || "")).toLowerCase();
  const ids = new Set(app.SCENARIOS.map((s) => s.id));
  const problems = [];
  let checked = 0, unchecked = [];
  for (const f of frames) {
    if (!ids.has(f.id)) continue;
    if (f.errors?.length) problems.push(`PAGEERR   ${f.id}: ${f.errors[0].slice(0, 140)}`);
    if (f.kind === "video" || f.kind === "img") { if (!f.src) problems.push(`NOMEDIA   ${f.id}`); continue; }
    if (!f.body || f.body.replace(/<[^>]+>/g, "").trim().length < 2 && !/<img|<svg|<canvas/.test(f.body)) problems.push(`EMPTY     ${f.id}: the page rendered nothing`);
    if (/\b(cannot get|404|not found|unmatched route)\b/i.test(text(f).slice(0, 4000)) && !WANT[f.id]) problems.push(`NOTFOUND? ${f.id}: looks like a 404 — check the route`);
    const want = WANT[f.id];
    if (!want) { unchecked.push(f.id); continue; }
    checked++;
    const t = text(f);
    const miss = want.filter((w) => w && !t.includes(String(w).toLowerCase()));
    if (miss.length) problems.push(`MISSING   ${f.id}: ${JSON.stringify(miss)}`);
  }
  for (const id of Object.keys(WANT)) if (!ids.has(id)) problems.push(`STALE-EXPECTATION ${id}: verify.mjs mentions a scenario that no longer exists`);
  if (mod.EXTRA) problems.push(...(await mod.EXTRA(frames)));
  problems.forEach((p) => console.log(p));
  console.log(`${frames.length} frames, ${checked} with content expectations, ${unchecked.length} without (${unchecked.slice(0, 6).join(", ")}${unchecked.length > 6 ? " …" : ""}), ${problems.length} problems`);
  return problems.length;
}
