/* ---------- copy a frame for Figma ----------
   Figma turns SVG text on the clipboard into editable layers (rectangles, vector shapes, live text). So a frame is
   re-mounted at 1:1 off-screen, and its RENDERED layout (getBoundingClientRect + computed styles, the browser's own
   answer, not a re-implementation of CSS) is written out as SVG: boxes with fills, gradients, borders, radii, shadows;
   text per line with the real font, size, weight and colour; images; inline icons; clips for overflow; transforms.
   Not carried over: ::before/::after content, inset shadows, filters/blend modes, background-clip text, form-control chrome. */
async function frameToSvg(f) {
  const W = f.width, H = Math.min(f.height, 4000);
  const X = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const GENERIC = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|segoe ui)$/i;
  const famName = fam => fam.split(",").map(x => x.replace(/["']/g, "").trim()).find(x => x && !GENERIC.test(x)) || "system font";
  const r2 = n => Math.round(n * 100) / 100;
  const head = body => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${X(f.title)}</title>${body}</svg>`;
  if (f.kind === "img" || f.kind === "video") {
    const src = f.kind === "img" ? f.src : f.poster;
    return { svg: head(`<g id="${X(f.title)}"><image href="${src}" x="0" y="0" width="${W}" height="${H}"/></g>`), layers: 1, fonts: [] };
  }
  // 1:1 off-screen mount
  const stash = document.createElement("div");
  stash.style.cssText = "position:fixed;left:-30000px;top:0;pointer-events:none";
  document.body.appendChild(stash);
  const host = mountFrame(stash, f, 1, W, H);
  host.style.overflow = "visible";
  const root = host.shadowRoot;
  const body = root.querySelector(".fbody");
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : null)));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  // the re-mounted frame replays its entry animations: jump every one to its end state before measuring
  for (let k = 0; k < 2; k++) {
    (root.getAnimations ? root.getAnimations() : [...root.querySelectorAll("*")].flatMap(n => n.getAnimations())).forEach(a => { try { a.finish(); } catch (e) { try { a.cancel(); } catch (e2) {} } });
    await new Promise(r => requestAnimationFrame(r));
  }
  host.getBoundingClientRect();
  const O = host.getBoundingClientRect();
  const cv = document.createElement("canvas").getContext("2d");
  const defs = [], fonts = new Set(), used = new Map();
  let uid = 0, layers = 0;

  const px1 = document.createElement("canvas"); px1.width = px1.height = 1;
  const pc = px1.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const color = str => { // any CSS colour (rgb, hex, color(), lab, oklch, ...) -> { c: "#rrggbb", a } via one pixel of the browser's own conversion
    if (!str || str === "transparent") return { c: "#000000", a: 0 };
    if (cache.has(str)) return cache.get(str);
    let out;
    const m = str.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]); out = { c: "#" + [m[1], m[2], m[3]].map(v => Math.round(parseFloat(v)).toString(16).padStart(2, "0")).join(""), a }; }
    else {
      pc.clearRect(0, 0, 1, 1); pc.fillStyle = "#000"; pc.fillStyle = str; pc.fillRect(0, 0, 1, 1);
      const d = pc.getImageData(0, 0, 1, 1).data;
      out = { c: "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""), a: d[3] / 255 };
    }
    cache.set(str, out); return out;
  };
  const fillAttr = (str, extra = 1) => { const k = color(str); return k.a === 0 ? null : ` fill="${k.c}"${k.a * extra < 1 ? ` fill-opacity="${r2(k.a * extra)}"` : ""}`; };
  const name = (el, fb) => {
    let n = el.getAttribute && (el.getAttribute("data-name") || el.getAttribute("aria-label") || el.id) || "";
    if (!n && el.classList && el.classList.length) n = el.classList[0];
    n = (n || fb || el.tagName.toLowerCase()).replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^[^\p{L}_]+/u, "_");
    const c = (used.get(n) || 0) + 1; used.set(n, c);
    return c === 1 ? n : n + "-" + c;
  };
  const splitTop = s => { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const px = (v, ref) => { if (!v || v === "normal" || v === "auto") return 0; if (v.endsWith("%")) return parseFloat(v) / 100 * ref; return parseFloat(v) || 0; };
  const radii = (cs, w, h) => {
    const R = ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map(k => { const p = cs["border" + k + "Radius"].split(" "); return [px(p[0], w), px(p[1] || p[0], h)]; });
    const k = Math.min(1, w / ((R[0][0] + R[1][0]) || 1e9), w / ((R[3][0] + R[2][0]) || 1e9), h / ((R[0][1] + R[3][1]) || 1e9), h / ((R[1][1] + R[2][1]) || 1e9)); // CSS scales all radii down together when they overlap
    return k < 1 ? R.map(([a, b]) => [a * k, b * k]) : R;
  };
  const rrPath = (x, y, w, h, R) => { // per-corner radii as a path
    const cl = R.map(([a, b]) => [Math.min(a, w / 2), Math.min(b, h / 2)]);
    return `M${r2(x + cl[0][0])} ${r2(y)}H${r2(x + w - cl[1][0])}A${cl[1][0]} ${cl[1][1]} 0 0 1 ${r2(x + w)} ${r2(y + cl[1][1])}V${r2(y + h - cl[2][1])}A${cl[2][0]} ${cl[2][1]} 0 0 1 ${r2(x + w - cl[2][0])} ${r2(y + h)}H${r2(x + cl[3][0])}A${cl[3][0]} ${cl[3][1]} 0 0 1 ${r2(x)} ${r2(y + h - cl[3][1])}V${r2(y + cl[0][1])}A${cl[0][0]} ${cl[0][1]} 0 0 1 ${r2(x + cl[0][0])} ${r2(y)}Z`;
  };
  const shape = (x, y, w, h, R, attrs) => {
    const same = R.every(r => r[0] === R[0][0] && r[1] === R[0][1]);
    if (R.every(r => r[0] === 0 && r[1] === 0)) return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"${attrs}/>`;
    if (same) return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(Math.min(R[0][0], w / 2))}" ry="${r2(Math.min(R[0][1], h / 2))}"${attrs}/>`;
    return `<path d="${rrPath(x, y, w, h, R)}"${attrs}/>`;
  };
  const gradient = (g, w, h, x, y) => { // CSS linear/radial gradient -> SVG paint, or a flat fallback colour
    const m = g.match(/^(repeating-)?(linear|radial)-gradient\((.*)\)$/s); if (!m) return null;
    const parts = splitTop(m[3]); let first = parts[0];
    let cfg = null; if (!/^(rgb|hsl|#|color|oklch|oklab|lab|lch)/i.test(first) && !/^[a-z]+\s+[\d.]+(%|px)/i.test(first) || /^(to |[\d.-]+deg|circle|ellipse|at |closest|farthest)/.test(first)) { cfg = first; parts.shift(); }
    const stops = parts.map(p => { const mm = p.match(/^(.*?)(?:\s+(-?[\d.]+)(%|px))?$/s); return { c: mm[1].trim(), o: mm[2] === undefined ? null : (mm[3] === "%" ? +mm[2] / 100 : +mm[2] / (m[2] === "linear" ? Math.hypot(w, h) : w)) }; });
    stops.forEach((s, i) => { if (s.o === null) s.o = i === 0 ? 0 : i === stops.length - 1 ? 1 : null; });
    for (let i = 0; i < stops.length; i++) if (stops[i].o === null) { let j = i; while (stops[j].o === null) j++; const a = stops[i - 1].o, b = stops[j].o; for (let k = i; k < j; k++) stops[k].o = a + (b - a) * (k - i + 1) / (j - i + 1); }
    const st = stops.map(s => { const k = color(s.c); return `<stop offset="${r2(s.o)}" stop-color="${k.c}"${k.a < 1 ? ` stop-opacity="${r2(k.a)}"` : ""}/>`; }).join("");
    const id = "g" + ++uid;
    if (m[2] === "linear") {
      let a = 180; const t = cfg || "to bottom";
      const km = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
      if (/deg$/.test(t)) a = parseFloat(t); else if (km[t] !== undefined) a = km[t]; else if (/turn$/.test(t)) a = parseFloat(t) * 360;
      const rad = a * Math.PI / 180, dx = Math.sin(rad), dy = -Math.cos(rad), L = Math.abs(w * dx) + Math.abs(h * dy), cx = x + w / 2, cy = y + h / 2;
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r2(cx - dx * L / 2)}" y1="${r2(cy - dy * L / 2)}" x2="${r2(cx + dx * L / 2)}" y2="${r2(cy + dy * L / 2)}">${st}</linearGradient>`);
    } else {
      let cx = x + w / 2, cy = y + h / 2; const at = (cfg || "").match(/at\s+(\S+)\s*(\S+)?/);
      if (at) { const p = (v, ref, o) => v === "center" || !v ? o + ref / 2 : v === "left" || v === "top" ? o : v === "right" || v === "bottom" ? o + ref : v.endsWith("%") ? o + parseFloat(v) / 100 * ref : o + parseFloat(v); cx = p(at[1], w, x); cy = p(at[2], h, y); }
      const rad = Math.max(Math.hypot(Math.max(cx - x, x + w - cx), Math.max(cy - y, y + h - cy)), 1);
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(rad)}">${st}</radialGradient>`);
    }
    return `url(#${id})`;
  };
  const dataSvg = src => { // inline an SVG data URI as nested <svg> so icons stay vector
    try {
      const raw = src.slice(src.indexOf(",") + 1);
      const txt = /;base64,/.test(src) ? decodeURIComponent(escape(atob(raw))) : decodeURIComponent(raw);
      const d = new DOMParser().parseFromString(txt, "image/svg+xml").documentElement;
      return d && d.nodeName === "svg" ? d : null;
    } catch { return null; }
  };
  const imageEl = (src, x, y, w, h, fit, label) => {
    if (/^data:image\/svg\+xml/.test(src)) {
      const d = dataSvg(src);
      if (d) { d.setAttribute("x", r2(x)); d.setAttribute("y", r2(y)); d.setAttribute("width", r2(w)); d.setAttribute("height", r2(h)); if (!d.getAttribute("viewBox") && d.getAttribute("width")) d.setAttribute("viewBox", `0 0 ${parseFloat(d.getAttribute("width"))} ${parseFloat(d.getAttribute("height"))}`); layers++; return new XMLSerializer().serializeToString(d); }
    }
    if (!/^data:/.test(src)) return "";
    layers++;
    return `<image id="${X(label)}" href="${src}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="${fit}"/>`;
  };
  const fitOf = (of) => of === "contain" || of === "scale-down" ? "xMidYMid meet" : of === "fill" ? "none" : "xMidYMid slice";
  const inlineSvg = (el, x, y, w, h) => {
    const c = el.cloneNode(true), a = [el, ...el.querySelectorAll("*")], b = [c, ...c.querySelectorAll("*")];
    a.forEach((o, i) => {
      const s = getComputedStyle(o), t = b[i];
      if (!t.setAttribute) return;
      for (const p of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "fill-rule"]) {
        const v = s.getPropertyValue(p);
        if (v && v !== "none" || p === "fill" || p === "stroke") if (v) t.setAttribute(p, v);
      }
      t.removeAttribute("class"); t.removeAttribute("style");
    });
    c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    c.setAttribute("x", r2(x)); c.setAttribute("y", r2(y)); c.setAttribute("width", r2(w)); c.setAttribute("height", r2(h));
    if (!c.getAttribute("viewBox")) c.setAttribute("viewBox", `0 0 ${parseFloat(el.getAttribute("width")) || w} ${parseFloat(el.getAttribute("height")) || h}`);
    layers++;
    return new XMLSerializer().serializeToString(c);
  };
  const textOut = (node, cs) => { // one <text> per rendered line, positioned from the browser's own line boxes
    const t = node.nodeValue; if (!t || !t.trim()) return "";
    const rg = document.createRange(), out = [];
    const tf = cs.textTransform, ws = cs.whiteSpace;
    const prep = s => { s = tf === "uppercase" ? s.toUpperCase() : tf === "lowercase" ? s.toLowerCase() : tf === "capitalize" ? s.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()) : s; return /^(pre|pre-wrap|break-spaces)$/.test(ws) ? s : s.replace(/\s+/g, " "); };
    const fam = cs.fontFamily, size = parseFloat(cs.fontSize);
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${fam}`;
    const asc = cv.measureText("x").fontBoundingBoxAscent || size * 0.9;
    let col = color(cs.color);
    if (col.a === 0 && /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || "")) { const g = (cs.backgroundImage.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i) || [])[0]; if (g) col = color(g); }
    if (col.a === 0) return "";
    fonts.add(famName(fam));
    const rtl = cs.direction === "rtl", ls = cs.letterSpacing !== "normal" ? parseFloat(cs.letterSpacing) : 0;
    const dec = /underline/.test(cs.textDecorationLine) ? "underline" : /line-through/.test(cs.textDecorationLine) ? "line-through" : "";
    // text-shadow: one extra copy of the line per shadow (first listed is on top), offset, in the shadow colour; blurred ones get a blur filter
    const shadows = cs.textShadow && cs.textShadow !== "none" ? splitTop(cs.textShadow).map(sh => {
      const m = sh.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8}|color\([^)]+\)|[a-z]+\([^)]*\))/i), n = sh.replace(m ? m[0] : "", "").match(/-?[\d.]+/g) || [];
      return m && n.length >= 2 ? { k: color(m[0]), dx: +n[0], dy: +n[1], blur: +(n[2] || 0) } : null;
    }).filter(Boolean).reverse() : [];
    const sw = parseFloat(cs.webkitTextStrokeWidth) || 0, sk = sw > 0 ? color(cs.webkitTextStrokeColor) : null;
    const stroke = sk && sk.a > 0 ? ` stroke="${sk.c}" stroke-width="${sw}" stroke-linejoin="round"${/stroke/.test(cs.paintOrder) ? ' paint-order="stroke"' : ""}` : "";
    const emit = (s, rc) => {
      s = s.replace(/^\s+|\s+$/g, ""); if (!s) return;
      const x = (rtl ? rc.right : rc.left) - O.left, y = rc.top + asc - O.top;
      const mk = (dx, dy, c, a, extra, label) => `<text${label ? ` id="${label}"` : ""} x="${r2(x + dx)}" y="${r2(y + dy)}" font-family="${X(fam)}" font-size="${size}" font-weight="${cs.fontWeight}"${cs.fontStyle !== "normal" ? ` font-style="${cs.fontStyle}"` : ""} fill="${c}"${a < 1 ? ` fill-opacity="${r2(a)}"` : ""}${ls ? ` letter-spacing="${r2(ls)}"` : ""}${dec ? ` text-decoration="${dec}"` : ""}${rtl ? ' text-anchor="end"' : ""}${stroke}${extra || ""} xml:space="preserve">${X(s)}</text>`;
      shadows.forEach((sh, n) => {
        let f = ""; if (sh.blur > 0) { const id = "b" + ++uid; defs.push(`<filter id="${id}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${r2(sh.blur / 2)}"/></filter>`); f = ` filter="url(#${id})"`; }
        layers++; out.push(mk(sh.dx, sh.dy, sh.k.c, sh.k.a, f, "text-shadow-" + (shadows.length - n)));
      });
      layers++; out.push(mk(0, 0, col.c, col.a, "", ""));
    };
    rg.selectNodeContents(node);
    const whole = [...rg.getClientRects()].filter(r => r.width > 0);
    if (whole.length <= 1) { if (whole[0]) emit(prep(t), whole[0]); return out.join(""); }
    // wrapped text: group characters by the line they landed on
    let line = "", box = null, top = null;
    const flush = () => { if (box) emit(prep(line), box); line = ""; box = null; top = null; };
    for (let i = 0; i < t.length;) {
      const step = t.codePointAt(i) > 0xffff ? 2 : 1;
      rg.setStart(node, i); rg.setEnd(node, i + step);
      const rc = rg.getClientRects()[0];
      if (rc && rc.width > 0 || (rc && /\S/.test(t[i]))) {
        if (top !== null && Math.abs(rc.top - top) > size * 0.5) flush();
        if (top === null) top = rc.top;
        box = box ? { left: Math.min(box.left, rc.left), right: Math.max(box.right, rc.right), top: Math.min(box.top, rc.top) } : { left: rc.left, right: rc.right, top: rc.top };
      }
      line += t.slice(i, i + step);
      i += step;
    }
    flush();
    return out.join("");
  };

  const walk = (el) => {
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|noscript|template|link|meta|head)$/.test(tag) || cs.display === "none" || el.hasAttribute("hidden")) return "";
    if (parseFloat(cs.opacity) === 0) return "";
    let undo = null;
    const hasT = cs.transform && cs.transform !== "none";
    let M = null, origin = null;
    if (hasT) { // measure the subtree untransformed, then wrap it in the matrix
      M = new DOMMatrix(cs.transform);
      const prev = el.style.getPropertyValue("transform"), pr = el.style.getPropertyPriority("transform");
      el.style.setProperty("transform", "none", "important");
      undo = () => { prev ? el.style.setProperty("transform", prev, pr) : el.style.removeProperty("transform"); };
      const tor = cs.transformOrigin.split(" ").map(parseFloat);
      const r0 = el.getBoundingClientRect();
      origin = [r0.left - O.left + (tor[0] || 0), r0.top - O.top + (tor[1] || 0)];
    }
    const rc = el.getBoundingClientRect();
    const x = rc.left - O.left, y = rc.top - O.top, w = rc.width, h = rc.height;
    let g = "";
    const vis = cs.visibility !== "hidden";
    const R = radii(cs, w, h);
    if (vis && w > 0 && h > 0 && tag !== "svg" && tag !== "img") {
      // shadow (outer, first only: Figma imports one reliably)
      const sh = cs.boxShadow !== "none" ? splitTop(cs.boxShadow).filter(s => !/inset/.test(s))[0] : null;
      let shAttr = "";
      if (sh) {
        const m = sh.match(/^(rgba?\([^)]+\)|#\w+|color\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*([\d.]+)?px?\s*(-?[\d.]+)?px?/);
        if (m) { const k = color(m[1]), id = "s" + ++uid; defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="${m[2]}" dy="${m[3]}" stdDeviation="${r2((+m[4] || 0) / 2)}" flood-color="${k.c}" flood-opacity="${r2(k.a)}"/></filter>`); shAttr = ` filter="url(#${id})"`; }
      }
      // background colour, then background images (last one is the bottom-most)
      const bg = fillAttr(cs.backgroundColor);
      const imgsBg = cs.backgroundImage !== "none" ? splitTop(cs.backgroundImage).reverse() : [];
      if (bg) { g += shape(x, y, w, h, R, bg + shAttr); layers++; }
      else if (shAttr && (cs.borderTopWidth !== "0px" || imgsBg.length)) g += shape(x, y, w, h, R, ` fill="#000" fill-opacity="0.001"${shAttr}`);
      for (const im of imgsBg) {
        if (/gradient\(/.test(im)) { const p = gradient(im, w, h, x, y); if (p) { g += shape(x, y, w, h, R, ` fill="${p}"`); layers++; } }
        else if (/^url\(/.test(im)) { const u = im.match(/url\(["']?(.*?)["']?\)/); if (u && /^data:/.test(u[1])) g += imageEl(u[1], x, y, w, h, /contain/.test(cs.backgroundSize) ? "xMidYMid meet" : /cover/.test(cs.backgroundSize) ? "xMidYMid slice" : "xMinYMin meet", name(el, "background")); }
      }
      // borders
      const bw = ["Top", "Right", "Bottom", "Left"].map(s => parseFloat(cs["border" + s + "Width"]) || 0), bc = ["Top", "Right", "Bottom", "Left"].map(s => cs["border" + s + "Color"]), bs = ["Top", "Right", "Bottom", "Left"].map(s => cs["border" + s + "Style"]);
      if (bw.some(v => v > 0) && bs.some(s => s !== "none" && s !== "hidden")) {
        if (bw.every(v => v === bw[0]) && bc.every(c => c === bc[0]) && color(bc[0]).a > 0) {
          const k = color(bc[0]), b = bw[0];
          const dash = bs[0] === "dashed" ? ` stroke-dasharray="${b * 3} ${b * 2}"` : bs[0] === "dotted" ? ` stroke-dasharray="0 ${b * 2}" stroke-linecap="round"` : "";
          g += shape(x + b / 2, y + b / 2, w - b, h - b, R.map(([a, c]) => [Math.max(a - b / 2, 0), Math.max(c - b / 2, 0)]), ` fill="none" stroke="${k.c}" stroke-width="${b}"${k.a < 1 ? ` stroke-opacity="${r2(k.a)}"` : ""}${dash}`); layers++;
        } else {
          const side = [[x, y, w, bw[0]], [x + w - bw[1], y, bw[1], h], [x, y + h - bw[2], w, bw[2]], [x, y, bw[3], h]];
          side.forEach((s, i) => { const f2 = bw[i] > 0 && fillAttr(bc[i]); if (f2) { g += `<rect x="${r2(s[0])}" y="${r2(s[1])}" width="${r2(s[2])}" height="${r2(s[3])}"${f2}/>`; layers++; } });
        }
      }
    }
    // replaced / special content
    if (vis && tag === "img") {
      const src = el.currentSrc || el.src;
      const nw = el.naturalWidth, nh = el.naturalHeight; let ix = x, iy = y, iw = w, ih = h;
      const of = cs.objectFit;
      if (nw && nh && (of === "contain" || of === "scale-down" || of === "none")) { const s = of === "none" ? 1 : Math.min(w / nw, h / nh); iw = nw * s; ih = nh * s; ix = x + (w - iw) / 2; iy = y + (h - ih) / 2; }
      let img = imageEl(src, ix, iy, iw, ih, fitOf(of), name(el, el.alt || "image"));
      if (img && R.some(r => r[0] > 0)) { const id = "c" + ++uid; defs.push(`<clipPath id="${id}">${shape(x, y, w, h, R, "")}</clipPath>`); img = `<g clip-path="url(#${id})">${img}</g>`; }
      g += img;
    } else if (vis && tag === "svg") {
      g += inlineSvg(el, x, y, w, h);
    } else if (vis && (tag === "input" || tag === "textarea" || tag === "select")) {
      let v = tag === "select" ? (el.selectedOptions[0] ? el.selectedOptions[0].text : "") : el.value;
      let alpha = 1; if (!v && el.placeholder) { v = el.placeholder; alpha = 0.5; }
      if (v && !/^(checkbox|radio|range|color|file)$/.test(el.type)) {
        const pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), size = parseFloat(cs.fontSize), fam = cs.fontFamily;
        cv.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${fam}`; const m = cv.measureText("x"); const asc = m.fontBoundingBoxAscent || size * .9, hh = asc + (m.fontBoundingBoxDescent || size * .25);
        const k = color(cs.color), rtl = cs.direction === "rtl"; fonts.add(famName(fam)); layers++;
        const shown = el.type === "password" ? "•".repeat(v.length) : v;
        g += `<text x="${r2(rtl ? x + w - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) : x + pl)}" y="${r2(y + (tag === "textarea" ? parseFloat(cs.paddingTop) + asc : (h - hh) / 2 + asc))}" font-family="${X(fam)}" font-size="${size}" font-weight="${cs.fontWeight}" fill="${k.c}" fill-opacity="${r2(k.a * alpha)}"${rtl ? ' text-anchor="end"' : ""} xml:space="preserve">${X(shown)}</text>`;
      }
    } else {
      // children in DOM order: text nodes and elements
      let inner = "";
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { if (vis) inner += textOut(n, cs); }
        else if (n.nodeType === 1) inner += walk(n);
      }
      const clip = /(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) && w > 0 && h > 0;
      if (clip && inner) { const id = "c" + ++uid; defs.push(`<clipPath id="${id}">${shape(x, y, w, h, R, "")}</clipPath>`); inner = `<g clip-path="url(#${id})">${inner}</g>`; }
      g += inner;
    }
    if (undo) undo();
    if (!g) return "";
    const op = parseFloat(cs.opacity), needG = op < 1 || M || (g.match(/<(rect|path|text|image|svg|g)\b/g) || []).length > 1 && (el.getAttribute("aria-label") || el.classList.length || el.id);
    if (!needG) return g;
    const tr = M ? ` transform="translate(${r2(origin[0])} ${r2(origin[1])}) matrix(${[M.a, M.b, M.c, M.d, M.e, M.f].map(r2).join(" ")}) translate(${r2(-origin[0])} ${r2(-origin[1])})"` : "";
    return `<g id="${X(name(el))}"${op < 1 ? ` opacity="${r2(op)}"` : ""}${tr}>${g}</g>`;
  };

  let inner = "";
  try { inner = walk(body); } finally { stash.remove(); }
  const bgc = color(getComputedStyle(document.documentElement).getPropertyValue("--frame-bg") || META.frameBg || "#fff");
  const frameName = X((f.title || f.id).replace(/[^\p{L}\p{N}_.\- ]+/gu, " ").trim() || f.id);
  const svg = head(`<!-- ${X(f.title)} · ${f.width}x${f.height} · fonts used: ${[...fonts].map(X).join(", ") || "none"} (install them in Figma for exact text) -->` +
    `<defs>${defs.join("")}</defs><g id="${frameName}"><rect id="background" x="0" y="0" width="${W}" height="${H}" fill="${bgc.c}"/>${inner}</g>`);
  return { svg, layers, fonts: [...fonts] };
}
