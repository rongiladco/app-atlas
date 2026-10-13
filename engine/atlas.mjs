#!/usr/bin/env node
// The atlas CLI.   node atlas.mjs <command> [app-dir] [flags]
//   init      scaffold product/atlas/ in an app (templates, .gitignore)
//   status    what is stale / new / removed / uncovered (exit 1 if anything)
//   capture   capture new + stale scenarios from the running app  (--all | --only a,b* | --prune | --base URL | --shots)
//   verify    content expectations + generic checks on the captured frames
//   build     assemble out/atlas.artifact.html
//   compare   <app> id1,id2   side-by-side check of atlas rendering vs the running app
//   rebaseline  mark every existing frame as current WITHOUT recapturing. Only after editing the `impact` map; never after a code change.
//   sync      capture -> verify -> build -> status   (the one command to run after a change)
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ENGINE, loadApp, status, printStatus } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const target = rest.find((a) => !a.startsWith("--") && (existsSync(resolve(a)) || a.startsWith("/") || a.startsWith(".")));
const flags = rest.filter((a) => a !== target);

if (cmd === "init") {
  const appDir = resolve(target || ".");
  const dir = join(appDir, "product", "atlas");
  mkdirSync(dir, { recursive: true });
  const T = join(ENGINE, "..", "templates");
  for (const f of ["atlas.config.mjs", "scenarios.mjs", "structure.mjs", "verify.mjs", "README.md"]) {
    if (existsSync(join(dir, f))) { console.log(`kept   ${f}`); continue; }
    copyFileSync(join(T, f), join(dir, f)); console.log(`wrote  product/atlas/${f}`);
  }
  const gi = join(appDir, ".gitignore");
  const have = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const add = ["product/atlas/out/", "product/atlas/.cache/"].filter((l) => !have.includes(l));
  if (add.length) { appendFileSync(gi, (have && !have.endsWith("\n") ? "\n" : "") + add.join("\n") + "\n"); console.log("updated .gitignore"); }
  console.log("\nnext: fill atlas.config.mjs (name, baseUrl, storage, routes), write scenarios for every screen, then:\n  node atlas.mjs sync " + appDir);
  process.exit(0);
}

const app = await loadApp(target);
if (cmd === "status") { const r = status(app); printStatus(r); process.exit(r.clean ? 0 : 1); }
else if (cmd === "capture") { const { capture } = await import("./capture.mjs"); await capture(app, flags); }
else if (cmd === "verify") { const { verify } = await import("./verify.mjs"); process.exit((await verify(app)) ? 1 : 0); }
else if (cmd === "build") { const { build } = await import("./build.mjs"); await build(app); }
else if (cmd === "compare") { const { compare } = await import("./compare.mjs"); await compare(app, (flags.find((a) => !a.startsWith("--")) || "").split(",").filter(Boolean)); }
else if (cmd === "rebaseline") {
  const { sourceFiles, scenarioHash, readJson, writeLock } = await import("./lib.mjs");
  const have = new Set(readJson(join(app.out, "frames.json"), []).map((f) => f.id));
  const files = sourceFiles(app), lock = { scenarios: {} };
  for (const s of app.SCENARIOS) if (have.has(s.id)) lock.scenarios[s.id] = { hash: scenarioHash(app, s, files), capturedAt: new Date().toISOString().slice(0, 10) };
  writeLock(app, lock); console.log(`rebaselined ${Object.keys(lock.scenarios).length} scenarios`);
} else if (cmd === "sync") {
  const { capture } = await import("./capture.mjs"), { verify } = await import("./verify.mjs"), { build } = await import("./build.mjs");
  await capture(app, [...flags, "--prune"]);
  const bad = await verify(app);
  await build(app);
  const r = status(app); printStatus(r);
  process.exit(bad || !r.clean || process.exitCode ? 1 : 0);
} else { console.log("usage: node atlas.mjs init|status|capture|verify|build|compare|sync [app-dir] [flags]"); process.exit(2); }
