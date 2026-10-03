// js/util.js
// Shared utilities used on every page (app, viewer, webify, tools).
// Decision: kept dependency-free (no Firebase import) so any page can load it cheaply.

/**
 * Human-friendly file size.
 *   < 1 KB   -> "512 B"
 *   < 1 MB   -> whole KB          (e.g. 348 KB)
 *   1-9.9 MB -> one decimal       (e.g. 5.7 MB)
 *   >= 10 MB -> whole MB          (e.g. 42 MB)   -> never more than 2 significant digits
 * Never shows more than one decimal.
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024) return Math.round(n) + " B";

  const kb = Math.round(n / 1024);
  if (kb < 1024) return kb + " KB";           // 1 .. 1023 KB

  const mb = n / 1048576;
  const rounded = Math.round(mb * 10) / 10;
  if (rounded >= 10) return Math.round(mb) + " MB";
  return rounded.toFixed(1) + " MB";
}

/** HTML-escape a value. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

/** Escape a string for use inside a RegExp. */
export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inject a <style> tag once (keyed by id). Lets JS modules ship their own small CSS. */
export function injectStyles(id, css) {
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

// ============================================================
// MULTI-WORD SEARCH (shared by app.js, viewer.js)
// ============================================================

/** Split a query into search words (min 2 chars), de-duplicated, lower-cased. */
export function splitQuery(q) {
  const seen = new Set();
  const out = [];
  for (const w of String(q || "").toLowerCase().split(/\s+/)) {
    if (w.length >= 2 && !seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

/**
 * Score one page of text against the query words (case-insensitive substring match).
 * Returns null when no words match, otherwise
 *   { matched: [...], missing: [...], total, full: boolean, snippet }
 */
export function matchPage(text, words) {
  const lower = String(text || "").toLowerCase();
  const matched = [], missing = [];
  let firstIdx = -1, firstLen = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0) {
      matched.push(w);
      if (firstIdx < 0 || i < firstIdx) { firstIdx = i; firstLen = w.length; }
    } else missing.push(w);
  }
  if (!matched.length) return null;
  const start = Math.max(0, firstIdx - 70);
  const end = Math.min(text.length, firstIdx + firstLen + 110);
  return {
    matched, missing,
    total: words.length,
    full: missing.length === 0,
    snippet: text.slice(start, end)
  };
}

/** Highlight any of the words inside already-plain text; returns safe HTML. */
export function highlightHTML(text, words) {
  const safe = esc(text);
  if (!words.length) return safe;
  const re = new RegExp("(" + words.map((w) => escapeRegExp(esc(w))).join("|") + ")", "ig");
  return safe.replace(re, "<mark>$1</mark>");
}

/** Sort: full matches first, then partial (more words first); inside each group by page number. */
export function sortHits(hits) {
  return hits.sort((a, b) =>
    (b.full - a.full) ||
    (!a.full && !b.full ? (b.matched.length - a.matched.length) : 0) ||
    (a.docName || "").localeCompare(b.docName || "") ||
    (a.page - b.page)
  );
}

/** HTML for the partial-match warning line. */
export function partialWarningHTML(h) {
  return `<div class="match-warn"><i class="fa-solid fa-triangle-exclamation"></i>
    <span>Found ${h.matched.length} of ${h.total} words on this page: matched
    ${h.matched.map((w) => `<b>'${esc(w)}'</b>`).join(", ")}.
    Missing: ${h.missing.map((w) => `<b>'${esc(w)}'</b>`).join(", ")}.</span></div>`;
}

/** HTML for the badge. */
export function matchBadgeHTML(h) {
  return h.full
    ? `<span class="match-badge full"><i class="fa-solid fa-circle-check"></i> All words found</span>`
    : `<span class="match-badge partial"><i class="fa-solid fa-circle-half-stroke"></i> Partial match (${h.matched.length}/${h.total})</span>`;
}

export const SEARCH_CSS = `
.match-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap}
.match-badge.full{background:#eaf5ee;color:#15502a;border:1px solid #bfe0cb}
.match-badge.partial{background:#fff4d6;color:#8a5a00;border:1px solid #f1d58a}
.match-warn{display:flex;gap:8px;align-items:flex-start;margin-top:10px;padding:9px 12px;border-radius:10px;background:#fff8e1;border:1px solid #f1d58a;color:#7a5200;font-size:12.5px;line-height:1.5}
.match-warn i{margin-top:3px}
.match-warn b{font-weight:700}
.head-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
`;
