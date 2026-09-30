// functions/render.js
// Renders a Webified site. One template, three visual treatments.
// Colour palette: green + white + black + red only. Quicksand everywhere.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

// ============================================================
// ICON MATCHER
// ============================================================
function iconFor(title) {
  const t = (title || "").toLowerCase();
  const map = [
    [/engine|motor|power/,           "fa-gears"],
    [/fuel|gas|tank/,                "fa-gas-pump"],
    [/brake|stopping|abs/,           "fa-brake-warning"],
    [/electric|battery|wire|circuit/,"fa-bolt"],
    [/suspension|shock|spring/,      "fa-car-side"],
    [/steering|wheel/,               "fa-steering-wheel"],
    [/transmis|gear|clutch/,         "fa-gear"],
    [/cool|radiat|thermostat/,       "fa-temperature-low"],
    [/exhaust|emission|cataly/,      "fa-wind"],
    [/body|chassis|frame|panel/,     "fa-car"],
    [/interior|cabin|seat/,          "fa-chair"],
    [/tyre|tire|wheel|rim/,          "fa-circle-notch"],
    [/safety|protect|warning/,       "fa-shield-halved"],
    [/maintenance|service|repair/,   "fa-screwdriver-wrench"],
    [/spec|technical|data|general/,  "fa-list-check"],
    [/diagnos|troubleshoot|error/,   "fa-stethoscope"],
    [/install|removal|remove/,       "fa-cubes"],
    [/lubric|oil|grease/,            "fa-oil-can"],
    [/intro|start|begin|overview/,   "fa-flag-checkered"],
    [/contact|support|help|get in/,  "fa-headset"],
    [/about|company|profile/,        "fa-building"],
    [/team|people|staff/,            "fa-users"],
    [/project|portfolio/,            "fa-diagram-project"],
    [/product|catalog/,              "fa-box"],
    [/price|cost|payment/,           "fa-tag"],
    [/feature|benefit/,              "fa-star"],
    [/faq|question|answer/,          "fa-circle-question"],
    [/legal|terms|policy/,           "fa-scale-balanced"],
    [/appendix|reference|note/,      "fa-bookmark"],
    [/contact|reach|email/,          "fa-envelope"],
    [/phone|call/,                   "fa-phone"],
    [/location|address|map/,         "fa-location-dot"],
    [/hour|time|schedule/,           "fa-clock"],
    [/spec|dimension|weight/,        "fa-ruler-combined"],
    [/colour|color|paint/,           "fa-palette"],
    [/warranty|guarantee/,           "fa-file-contract"],
    [/testimonial|review|rate/,      "fa-star-half-stroke"],
    [/pricing|cost|plan/,            "fa-tags"],
    [/overview|summary/,             "fa-book-open"],
    [/procedure|step|how to/,        "fa-list-ol"],
  ];
  for (const [re, icon] of map) if (re.test(t)) return icon;
  return "fa-circle-dot";
}

// ============================================================
// LOCKED COLOUR PALETTE
// Green + white + black + red. Nothing else.
// ============================================================
const COLORS = {
  green: "#1e6b3a",
  greenLight: "#2a8a4a",
  greenDark: "#15502a",
  greenBg: "#eaf5ee",
  white: "#ffffff",
  bg: "#f4f9f6",
  black: "#0f1a14",
  blackSoft: "#1a2a20",
  red: "#dc3545",
  text: "#16211c",
  textSoft: "#4d5f57",
  textLight: "#8a9f95",
  border: "#e2ece6",
};

// ============================================================
// SECTION BODY RENDERERS
// ============================================================
function stripTags(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function renderBody(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (/<(p|h[1-6]|img|ul|ol|li|blockquote|a|strong|em|b|i)\b/i.test(t)) return t;
  return t.split(/(?<=\.)\s+/).filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`).join("");
}

function renderProse(text) {
  return `<div class="sec-prose">${renderBody(text)}</div>`;
}

function renderSpecs(text) {
  const lines = stripTags(text).split(/\n|(?<=\.)\s+/).map(l => l.trim()).filter(Boolean);
  const specs = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Za-z0-9 \-_/]{1,40})[:=]\s*(.+)$/);
    if (m) specs.push({ label: m[1].trim(), value: m[2].trim() });
  }
  if (specs.length < 2) return renderProse(text);
  return `<div class="sec-specs">
    ${specs.map(s => `
      <div class="spec-row">
        <span class="spec-label">${esc(s.label)}</span>
        <span class="spec-value">${esc(s.value)}</span>
      </div>`).join("")}
  </div>`;
}

function renderBullets(text) {
  const lines = stripTags(text)
    .split(/\n|(?<=\.)\s+/)
    .map(l => l.replace(/^\s*[-•*·]\s*/, "").trim())
    .filter(l => l.length > 15);
  if (lines.length < 2) return renderProse(text);
  return `<ul class="sec-bullets">
    ${lines.map(l => `<li>${esc(l)}</li>`).join("")}
  </ul>`;
}

function renderFeature(text) {
  return `<div class="sec-feature">
    <div class="sec-feature-text">${renderBody(text)}</div>
  </div>`;
}

function renderStats(text) {
  const clean = stripTags(text);
  const matches = clean.match(/(\d{2,}(?:\.\d+)?)\s*(kg|lbs?|km|mi|mm|cm|m|L|l|hp|kW|rpm|%|yr|years|months?)\b/gi) || [];
  if (matches.length < 2) return renderProse(text);
  return `<div class="sec-stats">
    ${matches.slice(0, 4).map(m => {
      const p = m.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
      if (!p) return "";
      return `<div class="stat-card">
        <div class="stat-value">${esc(p[1])}</div>
        <div class="stat-label">${esc(p[2])}</div>
      </div>`;
    }).join("")}
  </div>
  <p class="stats-note">${esc(clean)}</p>`;
}

function renderQuote(text) {
  const clean = stripTags(text).replace(/^["“”']\s*/, "").replace(/["“”']\s*$/, "");
  return `<blockquote class="sec-quote">
    <div class="quote-mark"><i class="fa-solid fa-quote-left"></i></div>
    <p>${esc(clean)}</p>
  </blockquote>`;
}

function renderSectionBody(sec, site) {
  const type = sec.type && sec.type !== "auto" ? sec.type : detectType(sec);
  switch (type) {
    case "specs":   return renderSpecs(sec.text);
    case "bullets": return renderBullets(sec.text);
    case "feature": return renderFeature(sec.text);
    case "stats":   return renderStats(sec.text);
    case "quote":   return renderQuote(sec.text);
    case "cta":     return renderInlineCTA(sec);
    case "prose":
    default:        return renderProse(sec.text);
  }
}

function detectType(sec) {
  const text = stripTags(sec.text || "");
  const title = (sec.title || "").toLowerCase();
  if (/contact|reach|get in touch|enquir|hire us|call us|email us/.test(title)) return "cta";
  if (/^\s*["“”']/.test(text) && text.length < 400) return "quote";
  const specLines = (text.match(/(?:^|\n)\s*[A-Z][A-Za-z ]+[:=]\s*[^\n]+/g) || []).length;
  if (specLines >= 2) return "specs";
  const statMatches = text.match(/\b\d{2,}(?:\.\d+)?\s*(?:kg|lbs?|km|mi|mm|cm|m|L|l|hp|kW|rpm|%|yr|years|months?)\b/gi) || [];
  if (statMatches.length >= 2 && text.length < 500) return "stats";
  const bullets = (text.match(/(?:^|\n)\s*[-•*·]\s+\S/g) || []).length;
  if (bullets >= 3) return "bullets";
  if (text.length < 220 && text.split(/[.!?]/).length <= 3) return "feature";
  return "prose";
}

function renderInlineCTA(sec) {
  return `<div class="sec-cta-inner">
    <h3>${esc(sec.title || "Get in touch")}</h3>
    <p>${esc(stripTags(sec.text || "").slice(0, 240))}</p>
    <a class="sec-cta-btn" href="#" onclick="return false;">
      <i class="fa-solid fa-arrow-right"></i> Get started
    </a>
  </div>`;
}

// ============================================================
// HEAD + FONTS + TOKENS
// ============================================================
const HEAD_META = (s, o, title) => `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(s.hero || s.title)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(s.hero || s.title)}">
  <meta property="og:type" content="website">
  ${o.url ? `<meta property="og:url" content="${esc(o.url)}">` : ""}
`;

const FONTS = () => `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
`;

const CSS_VARS = `
  --p:${COLORS.green};
  --p-light:${COLORS.greenLight};
  --p-dark:${COLORS.greenDark};
  --p-bg:${COLORS.greenBg};
  --bg:${COLORS.bg};
  --surface:${COLORS.white};
  --text:${COLORS.text};
  --text-soft:${COLORS.textSoft};
  --text-light:${COLORS.textLight};
  --border:${COLORS.border};
  --black:${COLORS.black};
  --black-soft:${COLORS.blackSoft};
  --red:${COLORS.red};
  --font:'Quicksand',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
`;

// ============================================================
// SHARED JS
// ============================================================
const SHARED_JS = `
  (function(){
    if (window.__pdf2web_init) return;
    window.__pdf2web_init = true;

    var prog = document.getElementById('readprogress');
    if (prog) {
      window.addEventListener('scroll', function() {
        var h = document.documentElement;
        var pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
        prog.style.width = Math.min(100, Math.max(0, pct)) + '%';
      }, { passive: true });
    }

    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll('[data-reveal]').forEach(function(el) { io.observe(el); });

    document.querySelectorAll('a[href^="#"]').forEach(function(a) {
      a.addEventListener('click', function(e) {
        var target = document.querySelector(a.getAttribute('href'));
        if (target) { e.preventDefault(); target.scrollIntoView({behavior:'smooth', block:'start'}); }
      });
    });

    var secs = Array.from(document.querySelectorAll('[data-section]'));
    var links = Array.from(document.querySelectorAll('[data-toc]'));
    if (secs.length && links.length) {
      function setActive() {
        var y = window.scrollY + 140, a = secs[0];
        secs.forEach(function(s) { if (s.offsetTop <= y) a = s; });
        links.forEach(function(l) { l.classList.toggle('active', l.getAttribute('href') === '#' + a.id); });
      }
      window.addEventListener('scroll', setActive, { passive: true });
      setActive();
    }

    document.querySelectorAll('[data-jump]').forEach(function(c) {
      c.addEventListener('click', function() {
        document.querySelectorAll('[data-jump]').forEach(function(x) { x.classList.remove('active'); });
        c.classList.add('active');
        var t = document.getElementById(c.dataset.jump);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    document.querySelectorAll('[data-top]').forEach(function(b) {
      b.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    });

    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function() {
        var v = this.value.toLowerCase().trim();
        document.querySelectorAll('[data-section-article]').forEach(function(c) {
          c.style.display = (!v || c.textContent.toLowerCase().includes(v)) ? '' : 'none';
        });
      });
    }
  })();
`;

// ============================================================
// MAIN RENDER — one template, editorial layout
// ============================================================
function renderClassic(s, o = {}) {
  const secs = (s.sections || []).filter(x => !x.hidden);
  const title = s.title || "Document";
  const subtitle = s.subtitle || s.hero || `Generated from your PDF`;

  return `<!DOCTYPE html><html lang="en"><head>
${HEAD_META(s, o, title)}
${FONTS()}
<style>
  :root { ${CSS_VARS} }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; scroll-padding-top: 90px; }
  body {
    font-family: var(--font); background: var(--bg); color: var(--text);
    line-height: 1.7; font-size: 16px; -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  a { color: inherit; text-decoration: none; }

  [data-reveal] { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }
  [data-reveal].in { opacity: 1; transform: none; }

  #readprogress {
    position: fixed; top: 0; left: 0; height: 3px; width: 0;
    background: var(--p); z-index: 9999; transition: width .08s linear;
  }

  /* ============================================================
     TOP BAR (black)
     ============================================================ */
  .topbar {
    background: var(--black); color: #fff; position: sticky; top: 0; z-index: 100;
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .topbar .inner {
    max-width: 1340px; margin: 0 auto; padding: 14px 24px;
    display: flex; align-items: center; gap: 20px;
  }
  .topbar .brand { display: flex; align-items: center; gap: 10px;
    font-weight: 800; font-size: 15px; color: #fff; flex-shrink: 0; }
  .topbar .brand .mark {
    width: 32px; height: 32px; border-radius: 9px;
    background: var(--p); color: #fff;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
  }
  .topbar .doc-title {
    flex: 1; min-width: 0; font-size: 13px; color: rgba(255,255,255,.6);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    padding-left: 12px; border-left: 1px solid rgba(255,255,255,.15);
  }
  .topbar .search-box {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
    border-radius: 999px; padding: 8px 16px;
    flex: 0 1 300px; min-width: 200px;
  }
  .topbar .search-box:focus-within { border-color: var(--p-light); background: rgba(255,255,255,.12); }
  .topbar .search-box i { color: rgba(255,255,255,.5); font-size: 12px; }
  .topbar .search-box input {
    border: 0; background: none; outline: 0; width: 100%;
    font: inherit; font-size: 13px; color: #fff;
  }
  .topbar .search-box input::placeholder { color: rgba(255,255,255,.4); }
  .topbar .btn-cta {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 18px; border-radius: 999px;
    background: var(--p); color: #fff;
    font-size: 13px; font-weight: 700; white-space: nowrap;
    transition: transform .15s, background .15s;
  }
  .topbar .btn-cta:hover { background: var(--p-light); transform: translateY(-1px); }
  @media (max-width: 720px) { .topbar .search-box, .topbar .doc-title { display: none; } }

  /* ============================================================
     HERO (white with green accent)
     ============================================================ */
  .hero {
    background: var(--surface);
    padding: 72px 24px 56px;
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  .hero-inner { max-width: 820px; margin: 0 auto; }
  .hero .kicker {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11.5px; font-weight: 800; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--p);
    padding: 8px 16px; border-radius: 999px;
    background: var(--p-bg); border: 1px solid var(--border);
    margin-bottom: 22px;
  }
  .hero h1 {
    font-size: clamp(30px, 5.5vw, 54px); line-height: 1.08;
    font-weight: 800; letter-spacing: -1.6px; color: var(--text); margin-bottom: 14px;
  }
  .hero .subtitle {
    font-size: clamp(16px, 2vw, 20px); color: var(--p-dark);
    max-width: 640px; margin: 0 auto 16px; font-weight: 600;
  }
  .hero .lead {
    font-size: clamp(15px, 1.8vw, 17px); color: var(--text-soft);
    max-width: 620px; margin: 0 auto 30px;
  }
  .hero .cta-row {
    display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;
    margin-bottom: 26px;
  }
  .hero .btn-primary {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 14px 28px; border-radius: 999px;
    background: var(--p); color: #fff;
    font-weight: 800; font-size: 14.5px;
    box-shadow: 0 6px 20px rgba(30,107,58,.2);
    transition: all .15s ease;
  }
  .hero .btn-primary:hover { background: var(--p-light); transform: translateY(-2px); }
  .hero .btn-secondary {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 14px 24px; border-radius: 999px;
    background: var(--surface); color: var(--p-dark);
    font-weight: 700; font-size: 14.5px;
    border: 1.5px solid var(--border);
    transition: all .15s ease;
  }
  .hero .btn-secondary:hover { border-color: var(--p); color: var(--p); }
  .hero .stats-row {
    display: inline-flex; align-items: center; gap: 6px;
    flex-wrap: wrap; justify-content: center;
  }
  .hero .stat {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px; border-radius: 999px;
    background: var(--bg); border: 1px solid var(--border);
    font-size: 12.5px; font-weight: 600; color: var(--text-soft);
  }
  .hero .stat i { color: var(--p); font-size: 11px; }

  /* ============================================================
     LAYOUT — TOC sidebar + main
     ============================================================ */
  .layout {
    max-width: 1340px; margin: 0 auto; padding: 40px 24px 80px;
    display: grid; grid-template-columns: 300px 1fr; gap: 40px;
    align-items: start;
  }
  @media (max-width: 960px) { .layout { grid-template-columns: 1fr; gap: 20px; padding: 24px 16px 60px; } }

  /* TOC */
  .toc {
    position: sticky; top: 90px;
    max-height: calc(100vh - 120px); overflow-y: auto;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 18px 14px;
    box-shadow: 0 1px 2px rgba(21,80,42,.06);
  }
  @media (max-width: 960px) { .toc { position: static; max-height: none; } }
  .toc h3 {
    font-size: 11px; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--text-light);
    margin-bottom: 12px; padding: 0 6px 12px;
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .toc h3 span { background: var(--p-bg); color: var(--p);
    padding: 2px 8px; border-radius: 999px; font-size: 10px; }
  .toc-list { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .toc-list a {
    display: flex; align-items: center; gap: 10px;
    padding: 10px; border-radius: 10px;
    font-size: 13.5px; font-weight: 600; color: var(--text-soft);
    transition: all .15s ease;
  }
  .toc-list a:hover { background: var(--p-bg); color: var(--p-dark); transform: translateX(2px); }
  .toc-list a.active { background: var(--p-bg); color: var(--p-dark);
    box-shadow: inset 3px 0 0 var(--p); }
  .toc-list a .num {
    font-size: 10.5px; font-weight: 800; color: var(--text-light);
    min-width: 22px; padding: 3px 6px; text-align: center;
    background: var(--bg); border-radius: 6px; flex-shrink: 0;
  }
  .toc-list a.active .num { background: var(--p); color: #fff; }

  /* CHIPS */
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 999px;
    background: var(--surface); border: 1.5px solid var(--border);
    font-size: 12.5px; font-weight: 700; color: var(--text-soft);
    cursor: pointer; user-select: none; white-space: nowrap;
    transition: all .15s ease;
  }
  .chip i { color: var(--p); font-size: 11px; }
  .chip:hover { border-color: var(--p); color: var(--p-dark); transform: translateY(-1px); }
  .chip.active { background: var(--p); border-color: var(--p); color: #fff; }
  .chip.active i { color: #fff; }

  /* ARTICLE */
  article[data-section-article] {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 18px; padding: 36px 40px;
    margin-bottom: 22px; scroll-margin-top: 90px;
    transition: border-color .2s;
  }
  article[data-section-article]:hover { border-color: var(--border); }
  @media (max-width: 640px) { article[data-section-article] { padding: 26px 20px; } }

  article .head {
    display: flex; align-items: flex-start; gap: 16px; margin-bottom: 22px;
  }
  article .icon-badge {
    width: 56px; height: 56px; border-radius: 14px;
    background: var(--p-bg); color: var(--p);
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; flex-shrink: 0;
    transition: transform .2s;
  }
  article:hover .icon-badge { transform: scale(1.06) rotate(-4deg); }
  article .head-text { flex: 1; min-width: 0; }
  article .section-num {
    font-size: 11px; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--text-light);
    margin-bottom: 6px; display: block;
  }
  article h2 {
    font-size: clamp(22px, 2.8vw, 32px); line-height: 1.2;
    font-weight: 800; letter-spacing: -.6px;
  }
  article .summary {
    font-size: 14.5px; color: var(--text-soft); margin-top: 8px; font-weight: 500;
  }

  /* Section body types */
  .sec-prose { font-size: 16.5px; line-height: 1.75; max-width: 70ch; }
  .sec-prose p { margin-bottom: 1.05em; }
  .sec-prose p:last-child { margin-bottom: 0; }
  .sec-prose img { max-width: 100%; border-radius: 12px; margin: 16px 0; display: block; }

  .sec-specs {
    display: grid; gap: 0;
    border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
  }
  .spec-row {
    display: grid; grid-template-columns: 1fr 1.5fr;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
    font-size: 14.5px;
  }
  .spec-row:last-child { border-bottom: 0; }
  .spec-row:nth-child(even) { background: var(--bg); }
  .spec-label { font-weight: 700; color: var(--text-soft); }
  .spec-value { font-weight: 600; color: var(--text); }

  .sec-bullets { list-style: none; display: flex; flex-direction: column; gap: 12px; padding: 0; }
  .sec-bullets li {
    padding-left: 30px; position: relative;
    font-size: 15.5px; line-height: 1.7; color: var(--text);
  }
  .sec-bullets li::before {
    content: ''; position: absolute; left: 4px; top: 10px;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--p); box-shadow: 0 0 0 4px var(--p-bg);
  }

  .sec-feature {
    background: var(--p-bg); border-left: 4px solid var(--p);
    padding: 20px 24px; border-radius: 10px;
  }
  .sec-feature-text { font-size: 15.5px; line-height: 1.7; color: var(--p-dark); font-weight: 500; }
  .sec-feature-text p { margin: 0; }

  .sec-stats {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 14px; margin-bottom: 18px;
  }
  .stat-card {
    background: var(--p-bg); border: 1px solid var(--border);
    border-radius: 14px; padding: 22px 18px; text-align: center;
  }
  .stat-value {
    font-size: 32px; font-weight: 800; color: var(--p-dark);
    letter-spacing: -1px; line-height: 1.1;
  }
  .stat-label {
    font-size: 12px; font-weight: 700; color: var(--text-soft);
    text-transform: uppercase; letter-spacing: .8px; margin-top: 8px;
  }
  .stats-note { font-size: 14.5px; color: var(--text-soft); line-height: 1.7; }

  .sec-quote {
    background: var(--p-bg); border-radius: 16px;
    padding: 32px 36px; position: relative;
    border-left: 6px solid var(--p);
  }
  .sec-quote .quote-mark {
    position: absolute; top: 16px; right: 22px;
    font-size: 48px; color: var(--p); opacity: .15;
  }
  .sec-quote p {
    font-size: 19px; line-height: 1.55; font-weight: 600;
    color: var(--p-dark); margin: 0; font-style: italic;
  }

  .sec-cta-inner {
    background: var(--p); color: #fff;
    border-radius: 18px; padding: 40px 32px;
    text-align: center;
  }
  .sec-cta-inner h3 {
    font-size: clamp(22px, 3vw, 30px); font-weight: 800;
    letter-spacing: -.5px; margin-bottom: 10px; color: #fff;
  }
  .sec-cta-inner p {
    font-size: 15.5px; color: rgba(255,255,255,.85);
    max-width: 540px; margin: 0 auto 22px;
  }
  .sec-cta-btn {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 14px 28px; border-radius: 999px;
    background: #fff; color: var(--p-dark);
    font-weight: 800; font-size: 14.5px;
    box-shadow: 0 8px 20px rgba(0,0,0,.15);
    transition: transform .15s;
  }
  .sec-cta-btn:hover { transform: translateY(-2px); }

  /* Meta footer of each article */
  article .meta-row {
    display: flex; align-items: center; gap: 12px;
    flex-wrap: wrap; margin-top: 26px; padding-top: 20px;
    border-top: 1px solid var(--border);
    font-size: 12.5px; color: var(--text-light); font-weight: 600;
  }
  article .meta-row .pill {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--bg); padding: 6px 12px; border-radius: 999px;
    border: 1px solid var(--border);
  }
  article .meta-row .pill i { color: var(--p); font-size: 11px; }
  article .meta-row .pill.warn { color: var(--red); border-color: rgba(220,53,69,.25); }
  article .meta-row .pill.warn i { color: var(--red); }
  article .top-btn {
    margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    font-weight: 700; color: var(--text-light); font-size: 12px;
    background: none; border: 0; cursor: pointer;
    transition: color .15s, transform .15s;
  }
  article .top-btn:hover { color: var(--p); transform: translateY(-1px); }

  /* Mid-page CTA */
  .mid-cta {
    background: var(--p); color: #fff; border-radius: 18px;
    padding: 44px 32px; text-align: center; margin: 32px 0;
  }
  .mid-cta h3 {
    font-size: clamp(24px, 3vw, 34px); font-weight: 800;
    letter-spacing: -.6px; margin-bottom: 12px; color: #fff;
  }
  .mid-cta p { font-size: 16px; color: rgba(255,255,255,.85); max-width: 520px; margin: 0 auto 24px; }
  .mid-cta .btn {
    display: inline-flex; align-items: center; gap: 9px;
    padding: 15px 30px; border-radius: 999px;
    background: #fff; color: var(--p-dark);
    font-weight: 800; font-size: 15px;
    box-shadow: 0 8px 24px rgba(0,0,0,.15);
    transition: transform .15s;
  }
  .mid-cta .btn:hover { transform: translateY(-2px); }

  /* EMPTY */
  .empty {
    text-align: center; padding: 80px 30px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 18px;
  }
  .empty i { font-size: 42px; color: var(--p-light); opacity: .4; }
  .empty h3 { margin: 18px 0 8px; font-size: 20px; font-weight: 800; }
  .empty p { color: var(--text-soft); font-size: 14px; }

  /* FOOTER (black) */
  footer {
    background: var(--black); color: rgba(255,255,255,.7);
    padding: 48px 24px 32px;
  }
  footer .inner {
    max-width: 1340px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 20px;
  }
  footer .brand { display: flex; align-items: center; gap: 10px;
    font-weight: 800; font-size: 15px; color: #fff; }
  footer .brand .mark { width: 32px; height: 32px; border-radius: 9px;
    background: var(--p); display: flex; align-items: center; justify-content: center; font-size: 14px; }
  footer .meta-line { font-size: 12.5px; color: rgba(255,255,255,.5); }
  footer .meta-line a { color: var(--p-light); font-weight: 700; }
  footer .meta-line a:hover { color: #fff; }

  /* Editor hooks */
  body.__editing [data-edit] {
    outline: 1px dashed transparent; outline-offset: 3px;
    cursor: text; border-radius: 3px;
  }
  body.__editing [data-edit]:hover { outline-color: var(--p); background: var(--p-bg); }
  body.__editing [data-edit]:focus { outline: 2px solid var(--p); background: var(--p-bg); }
  body.__editing [data-section-article] {
    outline: 1px dashed transparent; outline-offset: 4px;
  }
  body.__editing [data-section-article]:hover { outline-color: rgba(30,107,58,.35); }
  body.__editing [data-section-article].__selected {
    outline: 2px solid var(--p); outline-offset: 4px;
  }
</style>
</head><body>

<div id="readprogress"></div>

<div class="topbar">
  <div class="inner">
    <a class="brand" href="#">
      <div class="mark"><i class="fa-solid fa-file-pdf"></i></div>
      <span>PDF2WEB</span>
    </a>
    <div class="doc-title" data-edit="title" data-edit-type="text">${esc(title)}</div>
    <label class="search-box">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input id="q" placeholder="Search sections…" aria-label="Search">
    </label>
    <a class="btn-cta" href="#top"><i class="fa-solid fa-arrow-up"></i> Top</a>
  </div>
</div>

<header class="hero" id="top" data-section-id="hero" data-section-type="hero">
  <div class="hero-inner">
    <span class="kicker"><i class="fa-solid fa-circle" style="font-size:6px"></i> Document</span>
    <h1><span data-edit="title" data-edit-type="text">${esc(title)}</span></h1>
    ${subtitle ? `<p class="subtitle" data-edit="subtitle" data-edit-type="text">${esc(subtitle)}</p>` : ""}
    ${s.hero ? `<p class="lead" data-edit="hero" data-edit-type="text">${esc(s.hero)}</p>` : ""}
    <div class="cta-row">
      <a class="btn-primary" href="#${esc(secs[0]?.id || "content")}">
        <i class="fa-solid fa-book-open"></i> Start reading
      </a>
      <a class="btn-secondary" href="#site-cta">
        <i class="fa-solid fa-envelope"></i> Get in touch
      </a>
    </div>
    <div class="stats-row">
      <span class="stat"><i class="fa-solid fa-list-ul"></i> ${secs.length} section${secs.length === 1 ? "" : "s"}</span>
      <span class="stat"><i class="fa-solid fa-magnifying-glass"></i> Full-text search</span>
    </div>
  </div>
</header>

<div class="layout">
  <aside class="toc">
    <h3>Contents <span>${secs.length}</span></h3>
    <ul class="toc-list">
      ${secs.map((x, i) => `
        <li>
          <a href="#${esc(x.id)}" data-toc>
            <span class="num">${String(i + 1).padStart(2, "0")}</span>
            <span>${esc(x.title)}</span>
          </a>
        </li>
      `).join("")}
    </ul>
  </aside>

  <main id="content">
    <div class="chips" id="chips">
      <span class="chip active" data-filter="all"><i class="fa-solid fa-layer-group"></i> All</span>
      ${secs.slice(0, 10).map(x => `
        <span class="chip" data-jump="${esc(x.id)}">
          <i class="fa-solid fa-hashtag"></i> ${esc((x.title || "").slice(0, 24))}${(x.title || "").length > 24 ? "…" : ""}
        </span>
      `).join("")}
    </div>

    ${secs.length ? secs.map((x, i) => {
      const icon = iconFor(x.title);
      const showMidCTA = (i === Math.floor(secs.length / 2)) && secs.length >= 4;
      return `
      <article id="${esc(x.id)}" data-section-article data-section-id="${esc(x.id)}" data-section="${esc(x.id)}" data-reveal>
        <div class="head">
          <div class="icon-badge"><i class="fa-solid ${icon}"></i></div>
          <div class="head-text">
            <span class="section-num">Section ${String(i + 1).padStart(2, "0")}</span>
            <h2 data-edit="section-title" data-section="${esc(x.id)}" data-edit-type="text">${esc(x.title)}</h2>
            ${x.summary ? `<p class="summary">${esc(x.summary)}</p>` : ""}
          </div>
        </div>
        <div data-edit="section-body" data-section="${esc(x.id)}" data-edit-type="html">
          ${renderSectionBody(x, s)}
        </div>
        <div class="meta-row">
          <span class="pill"><i class="fa-solid fa-book"></i> Source page ${esc(x.pages || x.page)}</span>
          ${x.type === "cta" ? `<span class="pill warn"><i class="fa-solid fa-circle-info"></i> Contact</span>` : ""}
          <button class="top-btn" data-top><i class="fa-solid fa-arrow-up"></i> Back to top</button>
        </div>
      </article>

      ${showMidCTA ? `
        <div class="mid-cta" data-section-id="mid-cta" data-section-type="cta">
          <h3>${esc(s.ctaTitle || "Ready to learn more?")}</h3>
          <p>${esc(s.ctaText || "Explore the original document for full details.")}</p>
          <a class="btn" href="#site-cta"><i class="fa-solid fa-arrow-right"></i> Continue</a>
        </div>
      ` : ""}
      `;
    }).join("") : `<div class="empty"><i class="fa-solid fa-inbox"></i><h3>No sections yet</h3><p>Add sections to build your site.</p></div>`}

    <div id="site-cta" data-section-id="site-cta" data-section-type="cta" data-reveal>
      <div class="sec-cta-inner">
        <h3>${esc(s.ctaTitle || "Ready to learn more?")}</h3>
        <p>${esc(s.ctaText || "Explore the original document for full details.")}</p>
        <a class="sec-cta-btn" href="#" onclick="return false;">
          <i class="fa-solid fa-envelope"></i> Get in touch
        </a>
      </div>
    </div>
  </main>
</div>

<footer>
  <div class="inner">
    <div class="brand">
      <div class="mark"><i class="fa-solid fa-file-pdf"></i></div>
      <span>Made with PDF2WEB</span>
    </div>
    <div class="meta-line">${esc(title)} · Generated from a PDF · <a href="#top">Back to top</a></div>
  </div>
</footer>

<script>${SHARED_JS}</script>
</body></html>`;
}

// Grid and Profile now both use the same Classic editorial layout.
// The template switcher in the editor is still available but visually identical
// until we build out the other two treatments later.
function renderGrid(s, o = {}) { return renderClassic(s, o); }
function renderProfile(s, o = {}) { return renderClassic(s, o); }

// ============================================================
// DISPATCHER
// ============================================================
exports.render = (site, opts = {}) => {
  return renderClassic(site, opts);
};