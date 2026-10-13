// Finds the screens an app has, so the atlas can prove it shows all of them. Returns null when routes are not declared.
//   routes: ["/", "/lesson/:id"]                      explicit list (always works)
//   routes: { discover: "expo-router" | "next-app" | "next-pages" | "static-html" | "grep", ... }
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, base = dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p, base, out); } else out.push(p.slice(base.length + 1));
  }
  return out;
};
const clean = (segs) => "/" + segs.filter((s) => s && !/^\(.*\)$/.test(s) && s !== "index").join("/").replace(/\[\.\.\.(\w+)\]/g, ":$1*").replace(/\[(\w+)\]/g, ":$1");

export function discoverRoutes(spec, appDir) {
  if (!spec) return null;
  if (Array.isArray(spec)) return spec;
  if (typeof spec === "function") return spec(appDir);
  const dir = (d) => join(appDir, spec.dir || d);
  switch (spec.discover) {
    case "expo-router": // app/**/*.tsx, minus layouts and +not-found, minus the atlas harness
      return walk(dir("app")).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f) && !/(^|\/)(_layout|\+[\w-]+|atlas-kit)\./.test(f)).map((f) => clean(f.replace(/\.\w+$/, "").split("/")));
    case "next-app":
      return walk(dir("app")).filter((f) => /(^|\/)page\.(tsx|ts|jsx|js)$/.test(f)).map((f) => clean(f.split("/").slice(0, -1)));
    case "next-pages":
      return walk(dir("pages")).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f) && !/^(_|api\/)/.test(f)).map((f) => clean(f.replace(/\.\w+$/, "").split("/")));
    case "static-html":
      return walk(dir(".")).filter((f) => /\.html$/.test(f) && !/^(node_modules|dist|product)\//.test(f)).map((f) => clean(f.replace(/\.html$/, "").split("/")));
    case "grep": { // a hash-router SPA: pull route patterns out of the file that declares them
      const text = readFileSync(join(appDir, spec.file), "utf8");
      const re = new RegExp(spec.pattern, "g");
      return [...text.matchAll(re)].map((m) => m[1]);
    }
    default:
      throw new Error("routes.discover must be one of expo-router | next-app | next-pages | static-html | grep");
  }
}
