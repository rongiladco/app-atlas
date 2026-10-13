// Turns the app's stylesheet into one that renders a FIXED-size frame inside a shadow root, on any page.
// Why: an iframe would give the frame its own viewport (so media queries and vw/vh just work), but the
// Artifact viewer blocks frames. Inside a shadow root the page's viewport leaks in, so we resolve it here:
//   - width/height media queries are evaluated for the frame's size and flattened away (the browser's own
//     matchMedia decides, so it is exact); dynamic ones (reduced motion, hover) stay as media queries
//   - vw / vh / dvh units become calc() over --fvw / --fvh, set on each frame
//   - :root and html become :host, body becomes .fbody (the wrapper the frame's markup lives in)
export async function flattenCss(browser, css, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  const out = await page.evaluate(
    ({ css }) => {
      const st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      const unit = (s) =>
        s
          .replace(/(-?\d*\.?\d+)(dvh|svh|lvh|vh)\b/g, "calc(var(--fvh) * $1 / 100)")
          .replace(/(-?\d*\.?\d+)(vw)\b/g, "calc(var(--fvw) * $1 / 100)");
      const sel = (s) =>
        s
          .split(",")
          .map((p) => p.trim())
          .map((p) => p
            .replace(/(^|[\s>+~(])html((?:\[[^\]]+\]|\.[\w-]+)+)/g, "$1:host($2)")   // html[dir=rtl] -> :host([dir=rtl])
            .replace(/:root/g, ":host")
            .replace(/(^|[\s>+~(])html(?![\w-])/g, "$1:host")
            .replace(/(^|[\s>+~(])body(?![\w-])/g, "$1.fbody"))
          .join(",");
      const STATIC = /^\(\s*(min-|max-)?(width|height|aspect-ratio|device-width|device-height)\b|^\(\s*orientation\b/;
      // One media condition: "A and B, C" -> true / false / the dynamic remainder
      const cond = (text) => {
        const branches = text.split(",").map((b) => b.trim()).filter(Boolean);
        const keep = [];
        for (const b of branches) {
          const parts = b.split(/\s+and\s+/i).map((x) => x.trim());
          let ok = true;
          const dyn = [];
          for (const p of parts) {
            if (STATIC.test(p)) {
              if (!matchMedia(p).matches) { ok = false; break; }
            } else dyn.push(p);
          }
          if (!ok) continue;
          if (!dyn.length) return true; // an always-true branch makes the whole list true
          keep.push(dyn.join(" and "));
        }
        return keep.length ? keep.join(", ") : false;
      };
      const walk = (rules) => {
        let o = "";
        for (const r of rules) {
          const t = r.constructor.name;
          if (t === "CSSStyleRule") {
            o += `${sel(r.selectorText)}{${unit(r.style.cssText)}}\n`;
          } else if (t === "CSSMediaRule") {
            const c = cond(r.conditionText || r.media.mediaText);
            if (c === true) o += walk(r.cssRules);
            else if (c) o += `@media ${c}{${walk(r.cssRules)}}\n`;
          } else if (t === "CSSSupportsRule") {
            o += `@supports ${r.conditionText}{${walk(r.cssRules)}}\n`;
          } else if (t === "CSSKeyframesRule") {
            o += unit(r.cssText) + "\n";
          } else {
            o += r.cssText + "\n";
          }
        }
        return o;
      };
      return walk(st.sheet.cssRules);
    },
    { css },
  );
  await ctx.close();
  return out;
}
