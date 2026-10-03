// functions/render.js
// Renders a webified site. ONE editorial layout (layoutVersion 2), typed section renderers.
// Palette: green + white + black + red only (flat colours; the single gradient is the hero's radial glow).
// Typography: Quicksand everywhere, weights 400-800.
// Decision: sections carry a structured `body` (from the AI) AND an HTML `text` (used by the editor).
// If the user edits `text` in the editor (signature differs from `textSig`) the edited HTML wins.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

// ============================================================
// FONT AWESOME FREE-SOLID ICON WHITELIST (AI suggestions are validated against this)
// ============================================================
const FA_ICONS = new Set(`fa-gears fa-gear fa-bolt fa-wrench fa-screwdriver-wrench fa-book-open fa-book fa-list-check
fa-list-ol fa-list fa-circle-info fa-shield-halved fa-triangle-exclamation fa-scale-balanced fa-file-contract fa-file-lines
fa-file-pdf fa-users fa-user fa-building fa-briefcase fa-chart-line fa-chart-pie fa-chart-simple fa-coins fa-dollar-sign
fa-tag fa-tags fa-box fa-boxes-stacked fa-truck fa-car fa-car-side fa-gas-pump fa-oil-can fa-plug fa-battery-full
fa-temperature-half fa-wind fa-droplet fa-leaf fa-seedling fa-tractor fa-wheat-awn fa-cow fa-paw fa-heart-pulse
fa-stethoscope fa-pills fa-flask fa-microscope fa-graduation-cap fa-school fa-lightbulb fa-rocket fa-flag-checkered
fa-star fa-trophy fa-medal fa-handshake fa-headset fa-envelope fa-phone fa-location-dot fa-map fa-globe fa-clock
fa-calendar-days fa-camera fa-image fa-images fa-palette fa-pen fa-pencil fa-ruler-combined fa-compass fa-hammer
fa-toolbox fa-lock fa-key fa-magnifying-glass fa-circle-question fa-quote-left fa-bookmark fa-check fa-circle-check
fa-arrow-right fa-house fa-laptop-code fa-code fa-database fa-server fa-cloud fa-wifi fa-mobile-screen fa-print
fa-stopwatch fa-scale-unbalanced fa-cubes fa-puzzle-piece fa-diagram-project fa-layer-group fa-sitemap fa-circle-dot
fa-hashtag fa-bullseye fa-thumbs-up fa-hand-holding-heart fa-road fa-bicycle fa-plane fa-ship fa-bus fa-industry
fa-warehouse fa-store fa-cart-shopping fa-credit-card fa-receipt fa-clipboard-list fa-clipboard-check fa-table
fa-table-list fa-flag fa-fire fa-snowflake fa-sun fa-water fa-mountain fa-tree fa-recycle fa-bell fa-eye fa-ear-listen
fa-language fa-comments fa-people-group fa-user-shield fa-user-tie fa-id-card fa-passport fa-hospital fa-house-medical
fa-baby fa-child fa-dumbbell fa-utensils fa-bowl-food fa-mug-hot fa-music fa-film fa-gamepad fa-futbol`.split(/\s+/).filter(Boolean));

function iconFor(title) {
  const t = (title || "").toLowerCase();
  const map = [
    [/engine|motor|power/, "fa-gears"], [/fuel|gas|tank/, "fa-gas-pump"], [/brake|stopping|abs/, "fa-triangle-exclamation"],
    [/electric|battery|wire|circuit/, "fa-bolt"], [/suspension|shock|spring|steering|wheel/, "fa-car-side"],
    [/transmis|gear|clutch/, "fa-gear"], [/cool|radiat|thermostat|temperature/, "fa-temperature-half"],
    [/exhaust|emission|cataly|air/, "fa-wind"], [/body|chassis|frame|vehicle|car\b/, "fa-car"],
    [/safety|protect|warning|caution|danger/, "fa-shield-halved"], [/maintenance|service|repair/, "fa-screwdriver-wrench"],
    [/spec|technical|data|general/, "fa-list-check"], [/diagnos|troubleshoot|error/, "fa-stethoscope"],
    [/install|assembly|component/, "fa-cubes"], [/lubric|oil|grease/, "fa-oil-can"],
    [/intro|start|begin|overview|welcome/, "fa-flag-checkered"], [/contact|support|help|get in|reach/, "fa-headset"],
    [/about|company|profile|history/, "fa-building"], [/team|people|staff|member/, "fa-users"],
    [/project|portfolio|work/, "fa-diagram-project"], [/product|catalog|range|item/, "fa-box"],
    [/price|cost|payment|fee|tariff|budget|financ/, "fa-tag"], [/feature|benefit|advantage/, "fa-star"],
    [/faq|question|answer/, "fa-circle-question"], [/legal|terms|policy|licen|conditions/, "fa-scale-balanced"],
    [/appendix|reference|note|glossary/, "fa-bookmark"], [/email|mail/, "fa-envelope"], [/phone|call/, "fa-phone"],
    [/location|address|map|site/, "fa-location-dot"], [/hour|time|schedule|calendar|date/, "fa-clock"],
    [/dimension|weight|size/, "fa-ruler-combined"], [/colour|color|paint|design/, "fa-palette"],
    [/warranty|guarantee|contract|agreement/, "fa-file-contract"], [/review|testimonial|rating/, "fa-star"],
    [/procedure|step|how to|process|method/, "fa-list-ol"], [/summary|conclusion|result|finding/, "fa-clipboard-check"],
    [/research|study|analysis|report/, "fa-chart-line"], [/education|course|learn|school|training/, "fa-graduation-cap"],
    [/health|medical|patient/, "fa-heart-pulse"], [/farm|crop|agric|livestock|cattle/, "fa-seedling"],
    [/environment|sustainab|green/, "fa-leaf"], [/goal|objective|mission|vision|strategy/, "fa-bullseye"],
  ];
  for (const [re, icon] of map) if (re.test(t)) return icon;
  return "fa-circle-dot";
}

// ============================================================
// EDIT-DETECTION SIGNATURE (shared with webify.js)
// ============================================================
function plainOf(html) {
  return String(html || "")
    .replace(/<img\b[^>]*>/gi, " [img] ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
function sigOf(html) {
  const s = plainOf(html);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ":" + s.length;
}

// ============================================================
// PALETTE
// ============================================================
const C = {
  green: "#1e6b3a", greenLight: "#2a8a4a", greenDark: "#15502a", greenBg: "#eaf5ee",
  white: "#ffffff", bg: "#f4f9f6", black: "#0f1a14", blackSoft: "#16241c", red: "#dc3545",
  text: "#16211c", textSoft: "#4d5f57", textLight: "#8a9f95", border: "#e2ece6",
};
const hexOk = v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());

// ============================================================
// BODY RENDERERS (structured -> HTML). Every value is escaped.
// ============================================================
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === "string" ? v : (v == null ? "" : String(v));

function paragraphsHTML(list) {
  return arr(list).map(p => str(p).trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
}

function rProse(body, extra) {
  const paras = arr(body).map(str).filter(Boolean);
  const total = paras.join(" ").length;
  const cols = total > 900 && paras.length > 2;
  return `<div class="sec-prose${cols ? " cols" : ""}">${paragraphsHTML(paras)}${paragraphsHTML(extra)}</div>`;
}

function rSpecs(body, extra) {
  const rows = arr(body).filter(r => r && (r.label || r.value));
  if (!rows.length) return rProse(extra, []);
  return `<div class="sec-specs">${rows.map(r => `
    <div class="spec-row"><span class="spec-label">${esc(r.label)}</span><span class="spec-value">${esc(r.value)}</span></div>`).join("")}</div>${extraHTML(extra)}`;
}

function rBullets(body, extra) {
  const items = arr(body).map(str).filter(Boolean);
  if (!items.length) return rProse(extra, []);
  return `<ul class="sec-bullets">${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>${extraHTML(extra)}`;
}

function rStats(body, extra) {
  const items = arr(body).filter(x => x && x.value);
  if (!items.length) return rProse(extra, []);
  return `<div class="sec-stats">${items.slice(0, 8).map(x => `
    <div class="stat-card"><div class="stat-value">${esc(x.value)}</div><div class="stat-label">${esc(x.label)}</div></div>`).join("")}</div>${extraHTML(extra)}`;
}

function rQuote(body, extra) {
  const b = (body && typeof body === "object" && !Array.isArray(body)) ? body : { text: str(body) };
  const text = str(b.text).trim();
  if (!text) return rProse(extra, []);
  return `<blockquote class="sec-quote"><div class="quote-mark"><i class="fa-solid fa-quote-left"></i></div>
    <p>${esc(text)}</p>${b.cite ? `<cite>${esc(b.cite)}</cite>` : ""}</blockquote>${extraHTML(extra)}`;
}

function rFeature(body, extra, icon) {
  const b = (body && typeof body === "object" && !Array.isArray(body)) ? body : { text: arr(body).join(" ") || str(body) };
  const text = str(b.text).trim();
  if (!text && !b.heading) return rProse(extra, []);
  return `<div class="sec-feature"><div class="feature-icon"><i class="fa-solid ${esc(icon)}"></i></div>
    <div><h3>${esc(b.heading || "")}</h3><p>${esc(text)}</p></div></div>${extraHTML(extra)}`;
}

function rTimeline(body, extra) {
  const items = arr(body).filter(x => x && (x.label || x.text));
  if (!items.length) return rProse(extra, []);
  return `<ol class="sec-timeline">${items.map(x => `
    <li><span class="tl-dot"></span><div class="tl-label">${esc(x.label)}</div><div class="tl-text">${esc(x.text)}</div></li>`).join("")}</ol>${extraHTML(extra)}`;
}

function rTable(body, extra) {
  const headers = arr(body?.headers).map(str);
  const rows = arr(body?.rows).map(r => arr(r).map(str));
  if (!rows.length) return rProse(extra, []);
  return `<div class="sec-table-wrap"><table class="sec-table">
    ${headers.length ? `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>` : ""}
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${extraHTML(extra)}`;
}

function rComparison(body, extra) {
  const side = x => ({ title: str(x?.title), items: arr(x?.items).map(str).filter(Boolean) });
  const l = side(body?.left), r = side(body?.right);
  if (!l.items.length && !r.items.length) return rProse(extra, []);
  const col = (s, cls) => `<div class="cmp-col ${cls}"><h3>${esc(s.title)}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
  return `<div class="sec-compare">${col(l, "a")}${col(r, "b")}</div>${extraHTML(extra)}`;
}

function rGallery(body, extra, preview) {
  const items = arr(body).filter(x => x && /^(https?:|data:image\/)/i.test(str(x.src)));
  if (!items.length) {
    if (!preview) return extraHTML(extra) || "";
    return `<div class="sec-gallery">${[0, 1, 2].map(() => `<div class="ph"><i class="fa-regular fa-image"></i><span>Add an image in the editor</span></div>`).join("")}</div>${extraHTML(extra)}`;
  }
  return `<div class="sec-gallery">${items.map(x => `<figure><img src="${esc(x.src)}" alt="${esc(x.caption || "")}" loading="lazy">${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ""}</figure>`).join("")}</div>${extraHTML(extra)}`;
}

function rCta(body, extra, sec) {
  const b = (body && typeof body === "object" && !Array.isArray(body)) ? body : { text: str(body) };
  return `<div class="sec-cta-inner"><h3>${esc(sec.title || "Get in touch")}</h3>
    <p>${esc(b.text || sec.summary || "")}</p>
    <a class="btn-white" href="#site-cta">${esc(b.buttonText || "Get in touch")} <i class="fa-solid fa-arrow-right"></i></a></div>${extraHTML(extra)}`;
}

function extraHTML(extra) {
  const p = paragraphsHTML(extra);
  return p ? `<div class="sec-prose extra">${p}</div>` : "";
}

// ---------- legacy / edited sections (HTML text only) ----------
function stripTags(html) { return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function renderHtmlBody(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/<(p|h[1-6]|img|ul|ol|li|blockquote|a|strong|em|b|i|table|br|div|span)\b/i.test(t)) return t;
  return t.split(/(?<=\.)\s+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
}
function detectLegacyType(sec) {
  const text = stripTags(sec.text || ""), title = (sec.title || "").toLowerCase();
  if (/contact|reach|get in touch|enquir|hire us|call us|email us/.test(title)) return "cta";
  if (/^\s*["“”']/.test(text) && text.length < 400) return "quote";
  if ((text.match(/(?:^|\s)[A-Z][A-Za-z ]{1,30}[:=]\s*\S+/g) || []).length >= 4) return "specs";
  return "prose";
}
function legacyBody(sec, preview) {
  const type = sec.type && sec.type !== "auto" ? sec.type : detectLegacyType(sec);
  const html = renderHtmlBody(sec.text);
  if (type === "cta") return `<div class="sec-cta-inner"><h3>${esc(sec.title)}</h3><p>${esc(stripTags(sec.text).slice(0, 240))}</p><a class="btn-white" href="#site-cta">Get in touch <i class="fa-solid fa-arrow-right"></i></a></div>`;
  if (type === "quote") return `<blockquote class="sec-quote"><div class="quote-mark"><i class="fa-solid fa-quote-left"></i></div><p>${esc(stripTags(sec.text))}</p></blockquote>`;
  if (type === "gallery") return `<div class="sec-gallery html">${html}</div>`;
  if (type === "feature") return `<div class="sec-feature"><div class="feature-icon"><i class="fa-solid ${esc(sec.icon && FA_ICONS.has(sec.icon) ? sec.icon : iconFor(sec.title))}"></i></div><div class="feature-html">${html}</div></div>`;
  return `<div class="sec-prose${stripTags(sec.text).length > 900 ? " cols" : ""} html">${html}</div>`;
}

function sectionBody(sec, preview) {
  const hasBody = sec.body !== undefined && sec.body !== null && sec.textSig;
  const edited = hasBody && typeof sec.text === "string" && sigOf(sec.text) !== sec.textSig;
  if (!hasBody || edited) return legacyBody(sec, preview);

  const icon = sec.icon && FA_ICONS.has(sec.icon) ? sec.icon : iconFor(sec.title);
  const extra = sec.extra;
  switch (sec.type) {
    case "specs": return rSpecs(sec.body, extra);
    case "bullets": return rBullets(sec.body, extra);
    case "stats": return rStats(sec.body, extra);
    case "quote": return rQuote(sec.body, extra);
    case "feature": return rFeature(sec.body, extra, icon);
    case "timeline": return rTimeline(sec.body, extra);
    case "table": return rTable(sec.body, extra);
    case "comparison": return rComparison(sec.body, extra);
    case "gallery": return rGallery(sec.body, extra, preview);
    case "cta": return rCta(sec.body, extra, sec);
    default: return rProse(sec.body, extra);
  }
}

// ============================================================
// HEAD
// ============================================================
const HEAD = (s, o, title, desc) => `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  ${o.url ? `<meta property="og:url" content="${esc(o.url)}">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">`;

// ============================================================
// CSS
// ============================================================
const CSS = (v) => `
:root{--p:${v.p};--p-light:${C.greenLight};--p-dark:${C.greenDark};--p-bg:${C.greenBg};--bg:${v.bg};--surface:#fff;
  --text:${v.text};--text-soft:${C.textSoft};--text-light:${C.textLight};--border:${C.border};
  --black:${C.black};--black-soft:${C.blackSoft};--red:${C.red};
  --font:'Quicksand',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;scroll-padding-top:84px}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.75;font-size:16px;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
img{max-width:100%}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

[data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .65s ease,transform .65s ease}
[data-reveal].in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){[data-reveal]{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}}

#readprogress{position:fixed;top:0;left:0;height:4px;width:0;background:var(--p);z-index:9999;transition:width .08s linear}

/* ---- top bar (black) ---- */
.topbar{background:var(--black);color:#fff;position:sticky;top:0;z-index:100;border-bottom:1px solid rgba(255,255,255,.08)}
.topbar .inner{max-width:1360px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:18px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:15px;letter-spacing:-.2px;flex-shrink:0}
.brand .mark{width:32px;height:32px;border-radius:9px;background:var(--p);display:flex;align-items:center;justify-content:center;font-size:14px}
.topbar .doc-title{flex:1;min-width:0;font-size:13px;color:rgba(255,255,255,.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:14px;border-left:1px solid rgba(255,255,255,.15)}
.search-box{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 16px;flex:0 1 280px;min-width:180px}
.search-box:focus-within{border-color:var(--p-light);background:rgba(255,255,255,.12)}
.search-box i{color:rgba(255,255,255,.5);font-size:12px}
.search-box input{border:0;background:none;outline:0;width:100%;font:inherit;font-size:13px;color:#fff}
.search-box input::placeholder{color:rgba(255,255,255,.4)}
.btn-green{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:999px;background:var(--p);color:#fff;font-weight:700;font-size:13px;white-space:nowrap;transition:transform .15s,background .15s}
.btn-green:hover{background:var(--p-light);transform:translateY(-1px)}
@media (max-width:760px){.search-box,.topbar .doc-title{display:none}.topbar .inner{justify-content:space-between}}

/* ---- hero (black + subtle green radial glow) ---- */
.hero{background:var(--black);color:#fff;position:relative;overflow:hidden;padding:96px 24px 84px;text-align:center}
.hero::before{content:"";position:absolute;inset:-20% -10% auto -10%;height:140%;pointer-events:none;
  background:radial-gradient(60% 55% at 50% 0%,rgba(42,138,74,.34) 0%,rgba(30,107,58,.12) 45%,rgba(15,26,20,0) 72%)}
.hero-inner{position:relative;max-width:940px;margin:0 auto}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#fff;background:var(--p);padding:8px 18px;border-radius:999px;margin-bottom:28px}
.hero h1{font-size:clamp(38px,7.4vw,84px);line-height:1.02;font-weight:800;letter-spacing:-.045em;color:#fff;margin-bottom:22px}
.hero .sub{font-size:clamp(17px,2.2vw,22px);color:rgba(255,255,255,.72);font-weight:500;max-width:720px;margin:0 auto 14px}
.hero .lead{font-size:clamp(15px,1.7vw,17px);color:rgba(255,255,255,.55);max-width:660px;margin:0 auto 38px}
.cta-row{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:34px}
.btn-lg{display:inline-flex;align-items:center;gap:10px;padding:16px 32px;border-radius:999px;font-weight:800;font-size:15.5px;transition:transform .15s,background .15s,color .15s}
.btn-lg.solid{background:var(--p);color:#fff}
.btn-lg.solid:hover{background:var(--p-light);transform:translateY(-2px)}
.btn-lg.outline{background:transparent;color:#fff;border:2px solid #fff}
.btn-lg.outline:hover{background:#fff;color:var(--black);transform:translateY(-2px)}
.hero-pills{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.hero-pills span{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.18);font-size:12.5px;font-weight:600;color:rgba(255,255,255,.75)}
.hero-pills i{color:var(--p-light);font-size:11px}
.hero-img{position:relative;max-width:1000px;margin:52px auto 0;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.12)}
.hero-img img{display:block;width:100%}

/* ---- chips ---- */
.chips-wrap{background:var(--surface);border-bottom:1px solid var(--border)}
.chips{max-width:1360px;margin:0 auto;padding:16px 24px;display:flex;gap:10px;overflow-x:auto;scrollbar-width:thin}
.chip{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;background:var(--surface);border:1.5px solid var(--border);font-size:13px;font-weight:700;color:var(--text-soft);cursor:pointer;white-space:nowrap;transition:all .15s}
.chip i{color:var(--p);font-size:11px}
.chip:hover{border-color:var(--p);color:var(--p-dark);transform:translateY(-1px)}
.chip.active{background:var(--p);border-color:var(--p);color:#fff}
.chip.active i{color:#fff}

/* ---- layout + TOC ---- */
.layout{max-width:1360px;margin:0 auto;padding:44px 24px 90px;display:grid;grid-template-columns:292px minmax(0,1fr);gap:44px;align-items:start}
@media (max-width:980px){.layout{grid-template-columns:1fr;gap:22px;padding:24px 16px 60px}}
.toc{position:sticky;top:84px;max-height:calc(100vh - 110px);overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:18px 14px}
@media (max-width:980px){.toc{display:none}}
.toc h3{font-size:11px;font-weight:800;letter-spacing:1.3px;text-transform:uppercase;color:var(--text-light);padding:0 8px 12px;margin-bottom:10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.toc h3 span{background:var(--p-bg);color:var(--p);padding:2px 9px;border-radius:999px;font-size:10px}
.toc ul{list-style:none;display:flex;flex-direction:column;gap:2px}
.toc a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--text-soft);line-height:1.35;transition:all .15s}
.toc a:hover{background:var(--p-bg);color:var(--p-dark)}
.toc a.active{background:var(--p-bg);color:var(--p-dark);box-shadow:inset 3px 0 0 var(--p)}
.toc .num{font-size:10.5px;font-weight:800;color:var(--text-light);min-width:24px;padding:3px 6px;text-align:center;background:var(--bg);border-radius:6px;flex-shrink:0}
.toc a.active .num{background:var(--p);color:#fff}
.toc-mobile{display:none}
@media (max-width:980px){.toc-mobile{display:block;position:sticky;top:60px;z-index:50;background:var(--bg);padding:8px 0}
  .toc-mobile select{width:100%;padding:13px 16px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface);font:inherit;font-weight:700;font-size:14px;color:var(--text)}}

/* ---- sections ---- */
.sec{background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:44px 48px;margin-bottom:26px;scroll-margin-top:84px}
@media (max-width:700px){.sec{padding:28px 20px;border-radius:18px}}
.sec .head{display:flex;gap:18px;align-items:flex-start;margin-bottom:26px}
.icon-badge{width:58px;height:58px;border-radius:16px;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:23px;flex-shrink:0}
.head-text{flex:1;min-width:0}
.eyebrow{display:block;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--p);margin-bottom:6px}
.sec h2{font-size:clamp(26px,3.4vw,40px);line-height:1.12;font-weight:800;letter-spacing:-.035em}
.sec .summary{font-size:16px;color:var(--text-soft);margin-top:10px;font-weight:500;max-width:70ch}

.sec-prose{font-size:16.5px;line-height:1.85}
.sec-prose p{margin-bottom:1.1em;max-width:70ch;break-inside:avoid-column}
.sec-prose p:last-child{margin-bottom:0}
.sec-prose.cols{column-count:2;column-gap:56px;max-width:calc(2*70ch + 56px)}
.sec-prose.cols p{max-width:none}
.sec-prose.extra{margin-top:22px}
.sec-prose.html img{max-width:100%;border-radius:12px;margin:16px 0;display:block}
@media (max-width:900px){.sec-prose.cols{column-count:1}}

.sec-specs{border:1px solid var(--border);border-radius:16px;overflow:hidden}
.spec-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:16px;padding:15px 22px;font-size:15px}
.spec-row:nth-child(odd){background:var(--surface)}
.spec-row:nth-child(even){background:var(--bg)}
.spec-label{font-weight:700;color:var(--text-soft)}
.spec-value{font-weight:700;color:var(--text);overflow-wrap:anywhere}
@media (max-width:560px){.spec-row{grid-template-columns:1fr;gap:2px}}

.sec-bullets{list-style:none;display:flex;flex-direction:column;gap:14px;max-width:78ch}
.sec-bullets li{position:relative;padding-left:32px;font-size:16px;line-height:1.7}
.sec-bullets li::before{content:"";position:absolute;left:4px;top:.6em;width:11px;height:11px;border-radius:50%;background:var(--p);box-shadow:0 0 0 5px var(--p-bg)}

.sec-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px}
.stat-card{background:var(--p);color:#fff;border-radius:18px;padding:28px 20px;text-align:center}
.stat-value{font-size:clamp(30px,4vw,46px);font-weight:800;letter-spacing:-.04em;line-height:1.05}
.stat-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-top:10px;color:rgba(255,255,255,.85)}

.sec-quote{background:var(--p-bg);border-left:7px solid var(--p);border-radius:6px 18px 18px 6px;padding:38px 44px;position:relative}
.sec-quote p{font-size:clamp(20px,2.4vw,27px);line-height:1.5;font-weight:600;font-style:italic;color:var(--p-dark)}
.sec-quote cite{display:block;margin-top:16px;font-style:normal;font-weight:800;font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:var(--p)}
.quote-mark{position:absolute;top:14px;right:22px;font-size:54px;color:var(--p);opacity:.14}

.sec-feature{display:flex;gap:22px;align-items:flex-start;background:var(--p-bg);border:1px solid var(--border);border-radius:20px;padding:30px 32px}
.feature-icon{width:54px;height:54px;border-radius:14px;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.sec-feature h3{font-size:21px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px;color:var(--p-dark)}
.sec-feature p,.feature-html{font-size:16px;color:var(--text);max-width:70ch}
@media (max-width:560px){.sec-feature{flex-direction:column}}

.sec-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.sec-gallery figure{border-radius:16px;overflow:hidden;border:1px solid var(--border);background:var(--bg)}
.sec-gallery img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:4/3}
.sec-gallery figcaption{padding:10px 14px;font-size:13px;font-weight:600;color:var(--text-soft)}
.sec-gallery .ph{aspect-ratio:4/3;border:2px dashed var(--border);border-radius:16px;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;color:var(--text-light);font-size:13px;font-weight:600}
.sec-gallery .ph i{font-size:26px}
.sec-gallery.html img{border-radius:16px;aspect-ratio:4/3;object-fit:cover}

.sec-timeline{list-style:none;position:relative;padding-left:34px;max-width:78ch}
.sec-timeline::before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:3px;background:var(--p-bg)}
.sec-timeline li{position:relative;padding-bottom:26px}
.sec-timeline li:last-child{padding-bottom:0}
.tl-dot{position:absolute;left:-34px;top:5px;width:21px;height:21px;border-radius:50%;background:var(--p);border:4px solid var(--surface);box-shadow:0 0 0 3px var(--p-bg)}
.tl-label{font-weight:800;font-size:13px;letter-spacing:.8px;text-transform:uppercase;color:var(--p)}
.tl-text{font-size:16px;margin-top:4px}

.sec-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:16px}
.sec-table{width:100%;border-collapse:collapse;font-size:14.5px}
.sec-table th{background:var(--black);color:#fff;text-align:left;padding:14px 18px;font-weight:700;white-space:nowrap}
.sec-table td{padding:13px 18px;border-top:1px solid var(--border)}
.sec-table tbody tr:nth-child(even){background:var(--bg)}

.sec-compare{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:700px){.sec-compare{grid-template-columns:1fr}}
.cmp-col{border-radius:18px;padding:28px;border:1.5px solid var(--border)}
.cmp-col.a{background:var(--p-bg);border-color:var(--p)}
.cmp-col.b{background:var(--surface)}
.cmp-col h3{font-size:19px;font-weight:800;margin-bottom:14px;color:var(--p-dark)}
.cmp-col ul{list-style:none;display:flex;flex-direction:column;gap:10px}
.cmp-col li{position:relative;padding-left:26px;font-size:15px}
.cmp-col li::before{content:"\\f00c";font-family:"Font Awesome 6 Free";font-weight:900;position:absolute;left:0;top:0;color:var(--p);font-size:13px}

.sec-cta-inner{background:var(--p);color:#fff;border-radius:20px;padding:46px 36px;text-align:center}
.sec-cta-inner h3{font-size:clamp(24px,3vw,34px);font-weight:800;letter-spacing:-.03em;margin-bottom:10px}
.sec-cta-inner p{font-size:16px;color:rgba(255,255,255,.88);max-width:560px;margin:0 auto 24px}
.btn-white{display:inline-flex;align-items:center;gap:10px;padding:15px 30px;border-radius:999px;background:#fff;color:var(--p-dark);font-weight:800;font-size:15px;transition:transform .15s}
.btn-white:hover{transform:translateY(-2px)}

.meta-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:30px;padding-top:20px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-light);font-weight:600}
.pill{display:inline-flex;align-items:center;gap:6px;background:var(--bg);padding:6px 12px;border-radius:999px;border:1px solid var(--border)}
.pill i{color:var(--p);font-size:11px}
.pill.warn{color:var(--red);border-color:rgba(220,53,69,.3)}
.pill.warn i{color:var(--red)}
.top-btn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:700;color:var(--text-light);font-size:12px;background:none;border:0;cursor:pointer}
.top-btn:hover{color:var(--p)}

/* ---- site CTA (green, full width) ---- */
.site-cta{background:var(--p);color:#fff;text-align:center;padding:96px 24px}
.site-cta h2{font-size:clamp(30px,5vw,54px);font-weight:800;letter-spacing:-.04em;line-height:1.08;margin-bottom:16px}
.site-cta p{font-size:clamp(16px,2vw,19px);color:rgba(255,255,255,.88);max-width:640px;margin:0 auto 34px}
.site-cta .btn-white{padding:18px 40px;font-size:16.5px}

/* ---- footer (black, 3 columns) ---- */
footer{background:var(--black);color:rgba(255,255,255,.7);padding:64px 24px 28px}
.f-grid{max-width:1360px;margin:0 auto;display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:48px}
@media (max-width:820px){.f-grid{grid-template-columns:1fr;gap:34px}}
footer h4{font-size:12px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#fff;margin-bottom:16px}
footer p{font-size:14px;line-height:1.7;max-width:46ch}
footer ul{list-style:none;display:flex;flex-direction:column;gap:10px}
footer li{font-size:14px;overflow-wrap:anywhere}
footer li a:hover{color:#fff}
footer li i{color:var(--p-light);width:18px}
.f-bottom{max-width:1360px;margin:48px auto 0;padding-top:22px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;font-size:12.5px;color:rgba(255,255,255,.45)}
.made{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);padding:7px 14px;border-radius:999px;font-weight:700;color:#fff}
.made .mark{width:22px;height:22px;border-radius:6px;background:var(--p);display:flex;align-items:center;justify-content:center;font-size:11px}

.empty{text-align:center;padding:80px 30px;background:var(--surface);border:1px solid var(--border);border-radius:22px}
.empty i{font-size:42px;color:var(--p);opacity:.35}
.empty h3{margin:18px 0 8px;font-size:20px;font-weight:800}
.no-results{display:none;text-align:center;padding:40px;color:var(--text-soft);font-weight:600}

/* editor hooks */
body.__editing [data-edit]{outline:1px dashed transparent;outline-offset:3px;cursor:text;border-radius:3px}
body.__editing [data-edit]:hover{outline-color:var(--p);background:var(--p-bg)}
body.__editing [data-edit]:focus{outline:2px solid var(--p);background:var(--p-bg)}
body.__editing [data-section-article]{outline:1px dashed transparent;outline-offset:4px}
body.__editing [data-section-article]:hover{outline-color:rgba(30,107,58,.35)}
body.__editing [data-section-article].__selected{outline:2px solid var(--p);outline-offset:4px}
`;

// ============================================================
// SHARED JS
// ============================================================
const JS = `
(function(){
  if (window.__pdf2web_init) return; window.__pdf2web_init = true;
  var doc = document.documentElement;
  var prog = document.getElementById('readprogress');
  function onScroll(){
    if (prog){ var max = doc.scrollHeight - doc.clientHeight; prog.style.width = (max > 0 ? Math.min(100, Math.max(0, doc.scrollTop / max * 100)) : 0) + '%'; }
    setActive();
  }
  var secs = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('[data-toc]'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-jump]'));
  var sel = document.getElementById('tocSelect');
  function setActive(){
    if (!secs.length) return;
    var y = window.scrollY + 130, cur = null;
    secs.forEach(function(s){ if (s.style.display !== 'none' && s.offsetTop <= y) cur = s; });
    var id = cur ? cur.id : null;
    tocLinks.forEach(function(l){ l.classList.toggle('active', !!id && l.getAttribute('href') === '#' + id); });
    chips.forEach(function(c){ c.classList.toggle('active', !!id && c.getAttribute('data-jump') === id); });
    if (sel && id) sel.value = id;
    var act = document.querySelector('.toc a.active');
    if (act && act.scrollIntoView && window.innerWidth > 980) { var box = act.closest('.toc'); if (box){ var r = act.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += (r.top - b.top) - b.height / 2; } }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', setActive);
  onScroll();

  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.06, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(function(el){ io.observe(el); });
  } else { document.querySelectorAll('[data-reveal]').forEach(function(el){ el.classList.add('in'); }); }

  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener('click', function(e){
      var h = a.getAttribute('href'); if (!h || h.length < 2) return;
      var t = document.querySelector(h);
      if (t){ e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
  chips.forEach(function(c){ c.addEventListener('click', function(){ var t = document.getElementById(c.getAttribute('data-jump')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); });
  if (sel) sel.addEventListener('change', function(){ var t = document.getElementById(sel.value); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  document.querySelectorAll('[data-top]').forEach(function(b){ b.addEventListener('click', function(){ window.scrollTo({ top: 0, behavior: 'smooth' }); }); });

  var q = document.getElementById('q'), none = document.getElementById('noResults');
  if (q){
    q.addEventListener('input', function(){
      var v = this.value.toLowerCase().trim(), shown = 0;
      document.querySelectorAll('[data-section-article]').forEach(function(c){
        var ok = !v || c.textContent.toLowerCase().indexOf(v) > -1;
        c.style.display = ok ? '' : 'none'; if (ok) shown++;
      });
      if (none) none.style.display = (v && !shown) ? 'block' : 'none';
      setActive();
    });
  }
})();
`;

// ============================================================
// MAIN RENDER
// ============================================================
function safeUrl(u) {
  const s = str(u).trim();
  return /^(https?:\/\/|data:image\/)/i.test(s) ? s : "";
}

function resolveTarget(label, secs) {
  const l = str(label).toLowerCase().trim();
  const hit = secs.find(x => str(x.title).toLowerCase() === l) ||
              secs.find(x => l && str(x.title).toLowerCase().includes(l)) ||
              secs.find(x => l && l.includes(str(x.title).toLowerCase()) && str(x.title).length > 3);
  return hit ? "#" + hit.id : "";
}

function renderSite(s, o = {}) {
  const preview = !!o.preview;
  const secs = arr(s.sections).filter(x => !x.hidden);
  const title = s.title || "Document";
  const hb = (s.heroBlock && typeof s.heroBlock === "object") ? s.heroBlock : {};
  const subtitle = s.subtitle || hb.subheading || "";
  const lead = typeof s.hero === "string" ? s.hero : "";
  const kicker = hb.kicker || (s.docType && s.docType !== "other" ? s.docType : "Document");
  const primaryText = hb.primaryCtaText || "Start reading";
  const secondaryText = hb.secondaryCtaText || "Get in touch";
  const colors = s.colors || {};
  const vars = {
    p: hexOk(colors.primary) ? colors.primary : C.green,
    bg: hexOk(colors.bg) ? colors.bg : C.bg,
    text: hexOk(colors.text) ? colors.text : C.text,
  };

  const cta = s.cta || {};
  const ctaTitle = s.ctaTitle || cta.heading || "Ready to learn more?";
  const ctaText = s.ctaText || cta.text || "Explore the full document or get in touch.";
  const ctaBtn = cta.buttonText || "Get in touch";

  const contact = s.contact || {};
  const email = arr(contact.emails)[0];
  const getInTouchHref = email ? `mailto:${esc(email)}` : "#contact";

  const heroImg = safeUrl(s.heroImage);
  const desc = lead || subtitle || title;

  const footer = s.footer || {};
  const tagline = footer.tagline || subtitle || lead || "";
  let quick = [];
  const qCol = arr(footer.columns).find(c => /quick|link|explore|navigate/i.test(str(c.heading))) || arr(footer.columns)[1];
  if (qCol) {
    quick = arr(qCol.links).map(l => {
      const label = typeof l === "string" ? l : str(l?.label);
      const href = (l && l.target) ? "#" + String(l.target).replace(/^#/, "") : resolveTarget(label, secs);
      return { label, href };
    }).filter(l => l.label && l.href);
  }
  if (quick.length < 3) quick = secs.slice(0, 6).map(x => ({ label: x.title, href: "#" + x.id }));

  const contactItems = [
    ...arr(contact.emails).slice(0, 2).map(v => `<li><i class="fa-solid fa-envelope"></i><a href="mailto:${esc(v)}">${esc(v)}</a></li>`),
    ...arr(contact.phones).slice(0, 2).map(v => `<li><i class="fa-solid fa-phone"></i><a href="tel:${esc(String(v).replace(/[^\d+]/g, ""))}">${esc(v)}</a></li>`),
    ...arr(contact.urls).slice(0, 2).map(v => `<li><i class="fa-solid fa-globe"></i><a href="${esc(/^https?:/i.test(v) ? v : "https://" + v)}" rel="noopener">${esc(v)}</a></li>`),
  ];

  const articles = secs.length ? secs.map((x, i) => {
    const icon = x.icon && FA_ICONS.has(x.icon) ? x.icon : iconFor(x.title);
    const body = sectionBody(x, preview);
    if (x.type === "gallery" && !body.trim()) return "";
    const isCta = x.type === "cta";
    return `
    <article class="sec" id="${esc(x.id)}" data-section-article data-section-id="${esc(x.id)}" data-section="${esc(x.id)}" data-reveal>
      <div class="head">
        <div class="icon-badge"><i class="fa-solid ${esc(icon)}"></i></div>
        <div class="head-text">
          <span class="eyebrow">Section ${String(i + 1).padStart(2, "0")}${x.type && x.type !== "auto" && x.type !== "prose" ? " · " + esc(x.type) : ""}</span>
          <h2 data-edit="section-title" data-section="${esc(x.id)}" data-edit-type="text">${esc(x.title)}</h2>
          ${x.summary ? `<p class="summary" data-edit="section-summary" data-section="${esc(x.id)}" data-edit-type="text">${esc(x.summary)}</p>` : ""}
        </div>
      </div>
      <div data-edit="section-body" data-section="${esc(x.id)}" data-edit-type="html">${body}</div>
      <div class="meta-row">
        ${x.pages || x.page ? `<span class="pill"><i class="fa-solid fa-book"></i> Source page ${esc(x.pages || x.page)}</span>` : ""}
        ${x.truncated ? `<span class="pill warn"><i class="fa-solid fa-circle-info"></i> Continues in the original PDF</span>` : ""}
        ${isCta ? `<span class="pill"><i class="fa-solid fa-headset"></i> Contact</span>` : ""}
        <button class="top-btn" data-top type="button"><i class="fa-solid fa-arrow-up"></i> Back to top</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty"><i class="fa-solid fa-inbox"></i><h3>No sections yet</h3><p>Add sections to build your site.</p></div>`;

  return `<!DOCTYPE html><html lang="en"><head>
${HEAD(s, o, title, desc)}
<style>${CSS(vars)}</style>
<noscript><style>[data-reveal]{opacity:1!important;transform:none!important}</style></noscript>
</head><body>
<div id="readprogress"></div>

<div class="topbar"><div class="inner">
  <a class="brand" href="#top"><span class="mark"><i class="fa-solid fa-file-pdf"></i></span><span>PDF2WEB</span></a>
  <div class="doc-title" data-edit="title" data-edit-type="text">${esc(title)}</div>
  <label class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="q" placeholder="Search this site…" aria-label="Search this site"></label>
  <a class="btn-green" href="${getInTouchHref}"><i class="fa-solid fa-envelope"></i> ${esc(secondaryText)}</a>
</div></div>

<header class="hero" id="top" data-section-id="hero" data-section-type="hero">
  <div class="hero-inner">
    <span class="kicker"><i class="fa-solid fa-circle" style="font-size:6px"></i> ${esc(kicker)}</span>
    <h1 data-edit="title" data-edit-type="text">${esc(title)}</h1>
    ${subtitle ? `<p class="sub" data-edit="subtitle" data-edit-type="text">${esc(subtitle)}</p>` : ""}
    ${lead ? `<p class="lead" data-edit="hero" data-edit-type="text">${esc(lead)}</p>` : ""}
    <div class="cta-row">
      <a class="btn-lg solid" href="#${esc(secs[0]?.id || "content")}"><i class="fa-solid fa-book-open"></i> ${esc(primaryText)}</a>
      <a class="btn-lg outline" href="${getInTouchHref}">${esc(secondaryText)} <i class="fa-solid fa-arrow-right"></i></a>
    </div>
    <div class="hero-pills">
      <span><i class="fa-solid fa-list-ul"></i> ${secs.length} section${secs.length === 1 ? "" : "s"}</span>
      ${s.pageCount ? `<span><i class="fa-solid fa-file-lines"></i> ${esc(s.pageCount)} source pages</span>` : ""}
      <span><i class="fa-solid fa-magnifying-glass"></i> Searchable</span>
    </div>
    ${heroImg ? `<div class="hero-img"><img src="${esc(heroImg)}" alt="${esc(title)}"></div>` : ""}
  </div>
</header>

${secs.length ? `<div class="chips-wrap"><div class="chips" id="chips">
  ${secs.slice(0, 8).map(x => `<span class="chip" data-jump="${esc(x.id)}" role="button" tabindex="0"><i class="fa-solid fa-hashtag"></i> ${esc(str(x.title).slice(0, 28))}${str(x.title).length > 28 ? "…" : ""}</span>`).join("")}
</div></div>` : ""}

<div class="layout">
  <aside class="toc" aria-label="Contents">
    <h3>Contents <span>${secs.length}</span></h3>
    <ul>${secs.map((x, i) => `<li><a href="#${esc(x.id)}" data-toc><span class="num">${String(i + 1).padStart(2, "0")}</span><span>${esc(x.title)}</span></a></li>`).join("")}</ul>
  </aside>

  <main id="content">
    <div class="toc-mobile"><label class="visually-hidden" for="tocSelect">Jump to section</label>
      <select id="tocSelect">${secs.map((x, i) => `<option value="${esc(x.id)}">${String(i + 1).padStart(2, "0")} · ${esc(x.title)}</option>`).join("")}</select></div>
    ${articles}
    <div class="no-results" id="noResults">No sections match your search.</div>
  </main>
</div>

<section class="site-cta" id="site-cta" data-section-id="site-cta" data-section-type="cta" data-reveal>
  <h2>${esc(ctaTitle)}</h2>
  <p>${esc(ctaText)}</p>
  <a class="btn-white" href="${getInTouchHref}">${esc(ctaBtn)} <i class="fa-solid fa-arrow-right"></i></a>
</section>

<footer id="contact">
  <div class="f-grid">
    <div><h4>About</h4><p><b style="color:#fff">${esc(title)}</b><br>${esc(tagline)}</p></div>
    <div><h4>Quick links</h4><ul>${quick.map(l => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")}</ul></div>
    <div><h4>Contact</h4><ul>${contactItems.length ? contactItems.join("") : `<li>Contact details were not found in the source document.</li>`}</ul></div>
  </div>
  <div class="f-bottom">
    <span>${esc(title)}${s.pageCount ? ` · from a ${esc(s.pageCount)}-page PDF` : ""}</span>
    <span class="made"><span class="mark"><i class="fa-solid fa-file-pdf"></i></span> Made with PDF2WEB</span>
  </div>
</footer>

<script>${JS}</script>
</body></html>`;
}

exports.render = (site, opts = {}) => renderSite(site, opts);
exports.sigOf = sigOf;
exports.plainOf = plainOf;
exports.FA_ICONS = FA_ICONS;
exports.iconFor = iconFor;
