// js/viewer.js
// PDF reader: instant open (IndexedDB cache), multi-word search with partial-match feedback,
// and back-to-results navigation that lives inside the viewer.
//
// Decisions:
//  * A URL with ?q= and NO ?page= opens straight on the results view. A URL with ?page= opens that page
//    (and, with from=search, keeps a "Back to results" path) — so shared page links still land on the page.
//  * Opening a result pushes a history entry; paging with prev/next only replaces it, so browser Back
//    returns to the results exactly once.

import { auth, db } from "./firebase.js";
import { watchUser } from "./auth.js";
import { FREE_PAGES } from "./documents.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getPdfBlob } from "./pdf-cache.js";
import {
  formatBytes, esc, escapeRegExp, splitQuery, matchPage, highlightHTML, sortHits,
  partialWarningHTML, matchBadgeHTML, SEARCH_CSS, injectStyles
} from "./util.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

injectStyles("pdf2web-search-css", SEARCH_CSS);
injectStyles("pdf2web-viewer-css", `
.back-results-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px}
.back-results-bar.hidden{display:none}
.back-results-bar .note{font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:10px}
.back-results-bar .note.warn{background:#fff8e1;border:1px solid #f1d58a;color:#7a5200}
.back-results-bar .note.ok{background:#eaf5ee;border:1px solid #bfe0cb;color:#15502a}
.back-results-bar .note.hidden{display:none}
.spin-only{display:flex;align-items:center;justify-content:center;min-height:320px;font-size:34px;color:var(--primary)}
`);

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const docId = params.get("doc");
const hasPageParam = params.has("page");
const startPage = parseInt(params.get("page") || "1", 10) || 1;
let query = (params.get("q") || "").trim();
let cameFromSearch = params.get("from") === "search";

let U = null, P = null;
let pdf = null;
let docMeta = null;
let currentPage = 1;
let premium = false;
let zoom = 1.3;
let textScale = 1;
let bookmarks = [];
let pageHistory = [];            // (renamed from `history` so window.history stays usable)
let currentRenderToken = 0;
let searchToken = 0;
let lastHits = null;             // [{page, matched, missing, total, full, snippet}]
let lastHitsQuery = "";
let pushedFromResults = false;

const pageTextCache = {};        // { pageNum: string }
let vocabulary = null;           // Set of all unique words across the PDF (built lazily)

const isNumeric = (q) => /^\d+$/.test(q);
const searchKey = () => `pdf2web_search_${docId}`;

const toast = (m) => {
  const t = $("toast");
  if (!t) return;
  t.textContent = m;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
};

// ============================================================
// LOADING STATES — nothing for fast opens, one spinner (no text) after 300 ms
// ============================================================
function spinnerAfter(ms = 300) {
  let cancelled = false;
  const t = setTimeout(() => {
    if (cancelled) return;
    const face = $("bookFace");
    if (face) face.innerHTML = '<div class="spin-only"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  }, ms);
  return () => { cancelled = true; clearTimeout(t); };
}

function showError(msg) {
  const face = $("bookFace");
  if (!face) return;
  face.innerHTML = `
    <div class="loader">
      <div class="loader-spinner" style="color:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <h3>Couldn't open this document</h3>
      <p class="meta">${esc(msg || "Please try again.")}</p>
      <a class="btn" href="app.html">Back to Library</a>
    </div>`;
}

const locked = (p) => !premium && p > FREE_PAGES;

// ============================================================
// URL + SESSION STATE
// ============================================================
function urlFor({ page, q, from } = {}) {
  const u = new URLSearchParams();
  u.set("doc", docId);
  if (page) u.set("page", String(page));
  if (q) u.set("q", q);
  if (from) u.set("from", from);
  return `viewer.html?${u.toString()}`;
}

function setUrl(state, mode = "replace") {
  try {
    window.history[mode === "push" ? "pushState" : "replaceState"](
      { v: state.page ? "page" : "results" }, "", urlFor(state)
    );
  } catch {}
}

function saveSearchState() {
  try {
    if (!query || !lastHits) { sessionStorage.removeItem(searchKey()); return; }
    sessionStorage.setItem(searchKey(), JSON.stringify({ q: lastHitsQuery, hits: lastHits.slice(0, 200) }));
  } catch {}
}

function restoreSearchState() {
  try {
    const raw = sessionStorage.getItem(searchKey());
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s && s.q === query && Array.isArray(s.hits)) {
      lastHits = s.hits; lastHitsQuery = s.q;
      return true;
    }
  } catch {}
  return false;
}

// ============================================================
// AUTH
// ============================================================
let loaded = false;
watchUser(async (user, profile) => {
  if (!user) { location.replace("index.html"); return; }
  U = user; P = profile;
  premium =
    profile?.plan === "premium" &&
    profile?.subscriptionStatus === "active" &&
    profile?.subscriptionExpiresAt?.toMillis?.() > Date.now();

  if (!docId) { location.replace("app.html"); return; }
  if (loaded) return;
  loaded = true;

  // Opening from a search with no explicit page -> show the results view immediately
  if (query && !hasPageParam) showResultsShell();

  loadBookmarks();      // not awaited — must never delay the PDF
  loadHistory();
  await loadDoc();
});

// ============================================================
// BOOKMARKS
// ============================================================
async function loadBookmarks() {
  try {
    const bmRef = doc(db, "users", U.uid, "bookmarks", docId);
    const snap = await getDoc(bmRef);
    bookmarks = snap.exists() ? (snap.data()?.pages || []) : [];
    renderBookmarks();
  } catch (e) { console.error(e); }
}

function renderBookmarks() {
  const list = $("bmList");
  const count = $("bmCount");
  if (!list) return;
  if (count) count.textContent = bookmarks.length;
  if (!bookmarks.length) {
    list.innerHTML = '<p class="side-empty">No bookmarks yet.</p>';
    return;
  }
  list.innerHTML = bookmarks.slice().sort((a, b) => a - b).map(p => `
    <div class="side-item">
      <button class="side-item-jump" data-goto="${p}">
        <i class="fa-solid fa-bookmark"></i> Page ${p}
      </button>
      <button class="side-item-del" data-rm="${p}" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`).join("");
}

// ============================================================
// HISTORY (recently viewed pages of this document)
// ============================================================
function historyKey() { return `pdf2web_history_${docId}`; }
function loadHistory() {
  try { pageHistory = JSON.parse(localStorage.getItem(historyKey()) || "[]"); }
  catch { pageHistory = []; }
  renderHistory();
}
function pushHistory(page) {
  pageHistory = pageHistory.filter(p => p !== page);
  pageHistory.unshift(page);
  pageHistory = pageHistory.slice(0, 8);
  try { localStorage.setItem(historyKey(), JSON.stringify(pageHistory)); } catch {}
  renderHistory();
}
function renderHistory() {
  const list = $("historyList");
  if (!list) return;
  if (!pageHistory.length) {
    list.innerHTML = '<p class="side-empty">No history yet.</p>';
    return;
  }
  list.innerHTML = pageHistory.map(p => `
    <button class="side-item-jump" data-goto="${p}">
      <i class="fa-solid fa-clock-rotate-left"></i> Page ${p}
    </button>`).join("");
}

// ============================================================
// LOAD PDF — no progress bar, no "parsing" screen.
//   cached in IndexedDB  -> opens immediately
//   not cached           -> one request (getBlob), nothing shown until 300 ms, then a bare spinner
// ============================================================
function applyMeta(snap) {
  if (!snap) return;
  if (!snap.exists()) {
    toast("Document not found");
    setTimeout(() => location.replace("app.html"), 800);
    return;
  }
  docMeta = snap.data();
  if ($("viewerTitle")) $("viewerTitle").textContent = docMeta.displayName || "Document";
  if ($("resultsDoc")) {
    $("resultsDoc").textContent = `${docMeta.displayName || "Document"} · ${formatBytes(docMeta.size || 0)}`;
  }
}

async function loadDoc() {
  const cancelSpinner = (query && !hasPageParam) ? () => {} : spinnerAfter(300);
  try {
    const defaultPath = `users/${U.uid}/documents/${docId}/original.pdf`;

    // Metadata and bytes load in parallel; the PDF never waits for Firestore.
    const metaP = getDoc(doc(db, "users", U.uid, "documents", docId)).catch(() => null);
    metaP.then(applyMeta);

    const blob = await getPdfBlob(U.uid, docId, [defaultPath]).catch(async (err) => {
      const snap = await metaP;
      const alt = snap?.exists() ? snap.data().storagePath : null;
      if (alt && alt !== defaultPath) return getPdfBlob(U.uid, docId, [alt]);
      throw err;
    });

    const data = new Uint8Array(await blob.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data }).promise;
    if ($("pageTotal")) $("pageTotal").textContent = pdf.numPages;

    if (query && !hasPageParam) {
      cancelSpinner();
      restoreSearchState();
      await runSearch(query, { updateUrl: false });
    } else {
      if (query && cameFromSearch) restoreSearchState();
      await go(startPage, { syncUrl: false });
      cancelSpinner();
    }
  } catch (e) {
    cancelSpinner();
    console.error("❌ loadDoc failed:", e);
    showError(e?.message || "Unknown error");
  }
}

// ============================================================
// VIEW HELPERS
// ============================================================
function showResultsShell() {
  $("pdfView")?.classList.add("hidden");
  $("resultsView")?.classList.remove("hidden");
  if ($("resultsSummary")) $("resultsSummary").textContent = "Searching…";
  if ($("resultsGrid")) {
    $("resultsGrid").innerHTML = '<p class="meta" style="padding:40px 0;text-align:center"><i class="fa-solid fa-spinner fa-spin"></i></p>';
  }
  updateBackBar();
}

function showPdfView() {
  $("resultsView")?.classList.add("hidden");
  $("pdfView")?.classList.remove("hidden");
  updateBackBar();
}

function resultsAvailable() {
  return !!query && !isNumeric(query) && !!lastHits;
}

// "← Back to results" bar + the match note above the page
async function updateBackBar() {
  const bar = $("backBar");
  const onPdf = !$("pdfView")?.classList.contains("hidden");
  const show = onPdf && !!query && !isNumeric(query) && (cameFromSearch || resultsAvailable());
  bar?.classList.toggle("hidden", !show);

  // top-left button doubles as "Results" while a search is active on a page
  document.querySelectorAll("[data-lib-label]").forEach(el => { el.textContent = show ? "Results" : "Library"; });

  const noteWarn = $("matchNoteWarn"), noteOk = $("matchNoteOk");
  noteWarn?.classList.add("hidden"); noteOk?.classList.add("hidden");
  if (!show || !pdf) return;

  const words = splitQuery(query);
  const text = await ensurePageText(currentPage);
  const m = matchPage(text, words);
  if (!m) {
    if (noteWarn) {
      noteWarn.textContent = `None of the ${words.length} search word${words.length === 1 ? "" : "s"} appear on this page.`;
      noteWarn.classList.remove("hidden");
    }
  } else if (!m.full) {
    if (noteWarn) {
      noteWarn.textContent = `Only ${m.matched.length} of ${m.total} words found on this page. Missing: ${m.missing.map(w => `'${w}'`).join(", ")}.`;
      noteWarn.classList.remove("hidden");
    }
  } else if (words.length > 1 && noteOk) {
    noteOk.textContent = `All ${words.length} words found on this page.`;
    noteOk.classList.remove("hidden");
  }
}

async function goBackToResults() {
  if (!query) { location.href = "app.html"; return; }
  if (pushedFromResults && window.history.state?.v === "page") {
    pushedFromResults = false;
    window.history.back();        // popstate handler shows the results
    return;
  }
  await showResults({ replaceUrl: true });
}

async function showResults({ replaceUrl = false } = {}) {
  showResultsShell();
  if (replaceUrl) setUrl({ q: query }, "replace");
  if (lastHits && lastHitsQuery === query) {
    renderResults(lastHits, query);
  } else if (restoreSearchState() && lastHitsQuery === query) {
    renderResults(lastHits, query);
  } else {
    await runSearch(query, { updateUrl: false });
  }
  updateBackBar();
}

// ============================================================
// GO TO PAGE — canvas + manual text layer
// ============================================================
async function go(p, { syncUrl = true } = {}) {
  if (!pdf) return;
  p = Math.max(1, Math.min(pdf.numPages, parseInt(p) || 1));
  currentPage = p;

  if ($("pageNum")) $("pageNum").value = p;
  if ($("pageTotal")) $("pageTotal").textContent = pdf.numPages;
  pushHistory(p);

  // Switch to PDF view
  $("pdfView")?.classList.remove("hidden");
  $("resultsView")?.classList.add("hidden");

  if (syncUrl) {
    setUrl({ page: p, q: query || undefined, from: cameFromSearch && query ? "search" : undefined }, "replace");
  }

  const face = $("bookFace");

  if (locked(p)) {
    face.innerHTML = `
      <div class="gate">
        <div class="crown"><i class="fa-solid fa-crown"></i></div>
        <h3>Unlock this page</h3>
        <p>This document continues beyond the free reading limit. Upgrade to Premium to access page ${FREE_PAGES + 1} and beyond.</p>
        <a class="btn primary" href="app.html">Upgrade</a>
      </div>`;
    updateBackBar();
    return;
  }

  const myToken = ++currentRenderToken;
  // Keep the current page on screen while the next renders; only show a bare spinner if it's slow.
  const slow = setTimeout(() => {
    if (myToken === currentRenderToken) face.innerHTML = '<div class="spin-only"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  }, 300);

  try {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: zoom * textScale });

    // 1. Canvas
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    if (myToken !== currentRenderToken) return;

    // 2. Page container
    const box = document.createElement("div");
    box.className = "pagebox";
    box.style.width = vp.width + "px";
    box.style.height = vp.height + "px";
    box.append(canvas);

    // 3. Manual text layer
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width = vp.width + "px";
    textLayerDiv.style.height = vp.height + "px";
    box.append(textLayerDiv);

    const textContent = await page.getTextContent();
    buildTextLayer(textLayerDiv, textContent, vp);
    if (myToken !== currentRenderToken) return;

    face.innerHTML = "";
    face.append(box);

    // 4. Highlight the words that actually occur on this page
    if (query && query.length >= 2 && !isNumeric(query)) {
      const text = await ensurePageText(p);
      const m = matchPage(text, splitQuery(query));
      if (m) applyHighlightToTextLayer(textLayerDiv, m.matched);
    }
    updateBackBar();
  } catch (e) {
    console.error("❌ Render failed:", e);
    if (myToken === currentRenderToken) {
      face.innerHTML = '<p style="padding:60px 0;text-align:center">Couldn\'t render this page.</p>';
    }
  } finally {
    clearTimeout(slow);
  }
}

// ============================================================
// MANUAL TEXT LAYER BUILDER
// ============================================================
function buildTextLayer(container, textContent, viewport) {
  const scale = viewport.scale;

  for (const item of textContent.items) {
    if (!item.str) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    if (fontHeight <= 0) continue;

    const angle = Math.atan2(tx[1], tx[0]);

    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.left = tx[4] + "px";
    span.style.top = (tx[5] - fontHeight) + "px";
    span.style.fontSize = fontHeight + "px";
    span.style.fontFamily = "sans-serif";
    span.style.whiteSpace = "pre";

    const strWidth = item.width * scale;
    const approxWidth = item.str.length * fontHeight * 0.5;
    if (approxWidth > 0 && strWidth > 0) {
      const sx = strWidth / approxWidth;
      span.style.transform = angle
        ? `rotate(${angle}rad) scaleX(${sx})`
        : `scaleX(${sx})`;
    } else if (angle) {
      span.style.transform = `rotate(${angle}rad)`;
    }

    container.appendChild(span);
  }
}

// ============================================================
// HIGHLIGHT matched words inside the text layer
// ============================================================
function applyHighlightToTextLayer(root, words) {
  if (!words || !words.length) return;
  const re = new RegExp("(" + words.map(escapeRegExp).join("|") + ")", "ig");

  root.querySelectorAll("span").forEach(span => {
    if (span.dataset._hl) return;
    const text = span.textContent || "";
    re.lastIndex = 0;
    let m = re.exec(text);
    if (!m) return;

    const frag = document.createDocumentFragment();
    let last = 0;
    while (m) {
      if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "hl-mark";
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
      m = re.exec(text);
    }
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    span.textContent = "";
    span.append(frag);
    span.dataset._hl = "1";
  });
}

function clearHighlights() {
  document.querySelectorAll(".hl-mark").forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  });
  document.querySelectorAll(".textLayer span").forEach(s => delete s.dataset._hl);
}

// ============================================================
// PAGE TEXT CACHE
// ============================================================
async function ensurePageText(p) {
  if (pageTextCache[p] !== undefined) return pageTextCache[p];
  try {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    pageTextCache[p] = tc.items.map(i => i.str).join(" ").replace(/\s+/g, " ");
  } catch {
    pageTextCache[p] = "";
  }
  return pageTextCache[p];
}

async function ensureAllText(isStale) {
  const total = pdf.numPages;
  const BATCH = 6;
  for (let start = 1; start <= total; start += BATCH) {
    const jobs = [];
    for (let p = start; p < start + BATCH && p <= total; p++) jobs.push(ensurePageText(p));
    await Promise.all(jobs);
    if (isStale && isStale()) return false;
  }
  return true;
}

// ============================================================
// BUILD VOCABULARY (unique words) FOR FUZZY SUGGESTIONS
// ============================================================
async function buildVocabulary() {
  if (vocabulary) return vocabulary;
  await ensureAllText();
  const set = new Set();
  for (let p = 1; p <= pdf.numPages; p++) {
    const words = (pageTextCache[p] || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    for (const w of words) set.add(w);
  }
  vocabulary = set;
  return vocabulary;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

async function suggestAlternatives(word) {
  const vocab = await buildVocabulary();
  const needle = word.toLowerCase();
  const maxDist = needle.length <= 4 ? 1 : 2;
  const candidates = [];
  for (const w of vocab) {
    if (Math.abs(w.length - needle.length) > maxDist) continue;
    const d = levenshtein(needle, w);
    if (d > 0 && d <= maxDist) candidates.push({ word: w, dist: d });
  }
  candidates.sort((a, b) => a.dist - b.dist || a.word.localeCompare(b.word));
  return candidates.slice(0, 5).map(c => c.word);
}

// ============================================================
// SEARCH — multi-word AND with partial matches
//   full match   : every word (>= 2 chars) appears somewhere on the page
//   partial match: some words appear -> still listed, with a warning
//   sorted       : full first, then partial; each group by page number
// ============================================================
let searchTimer = null;

async function runSearch(q, { updateUrl = true } = {}) {
  q = (q || "").trim();
  const grid = $("resultsGrid");
  const summary = $("resultsSummary");
  const dym = $("didYouMean");

  if (!q || q.length < 2) {
    query = "";
    lastHits = null;
    saveSearchState();
    showPdfView();
    return;
  }
  if (!pdf) return;

  query = q;
  const token = ++searchToken;

  showResultsShell();
  dym?.classList.add("hidden");
  if (updateUrl) setUrl({ q }, "replace");

  // Pure number -> jump-to-page card
  if (isNumeric(q)) {
    const p = parseInt(q, 10);
    lastHits = null;
    if (p >= 1 && p <= pdf.numPages) {
      summary.textContent = `Jump to page ${p}`;
      grid.innerHTML = `
        <div class="result-card">
          <div class="result-card-head"><b>Page ${p}</b></div>
          <p class="result-card-snippet">Open page ${p} of this document.</p>
          <div class="result-card-actions">
            <button class="result-card-open" data-goto-result="${p}">
              <i class="fa-solid fa-arrow-right"></i> Open page ${p}
            </button>
          </div>
        </div>`;
    } else {
      summary.textContent = "Page not found";
      grid.innerHTML = '<div class="results-empty"><i class="fa-solid fa-circle-xmark"></i><b>No such page</b>This document has ' + pdf.numPages + ' pages.</div>';
    }
    return;
  }

  const words = splitQuery(q);
  if (!words.length) {
    summary.textContent = "Type a word of 2 or more characters";
    grid.innerHTML = "";
    return;
  }

  const finished = await ensureAllText(() => token !== searchToken);
  if (!finished || token !== searchToken) return;

  const hits = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const m = matchPage(pageTextCache[p], words);
    if (m) hits.push({ page: p, ...m });
  }
  sortHits(hits);
  lastHits = hits;
  lastHitsQuery = q;
  saveSearchState();

  if (hits.length) {
    renderResults(hits, q);
    return;
  }

  // Nothing at all -> fuzzy suggestions for the first word that isn't in the document
  summary.textContent = `No matches for “${q}”`;
  grid.innerHTML = '<div class="results-empty"><i class="fa-solid fa-magnifying-glass"></i><b>No matches found</b>None of those words appear in this document.</div>';

  const vocab = await buildVocabulary();
  const bad = words.find(w => !vocab.has(w)) || words[0];
  const suggestions = await suggestAlternatives(bad);
  if (token !== searchToken) return;
  if (suggestions.length) {
    dym.classList.remove("hidden");
    dym.innerHTML = `<b>Did you mean…</b>` + suggestions.map(s => {
      const fixed = words.map(w => (w === bad ? s : w)).join(" ");
      return `<button class="suggestion" data-suggest="${esc(fixed)}"><i class="fa-solid fa-lightbulb"></i> ${esc(fixed)}</button>`;
    }).join("");
  }
}

function renderResults(hits, q) {
  const grid = $("resultsGrid");
  const summary = $("resultsSummary");
  const full = hits.filter(h => h.full).length;
  const partial = hits.length - full;
  summary.textContent =
    `${hits.length} page${hits.length === 1 ? "" : "s"} for “${q}” — ${full} with all words` +
    (partial ? `, ${partial} partial` : "");
  $("didYouMean")?.classList.add("hidden");

  grid.innerHTML = hits.map(h => `
    <div class="result-card">
      <div class="result-card-head">
        <b><i class="fa-solid fa-file-lines"></i> Page ${h.page}</b>
        <span class="head-right">${matchBadgeHTML(h)}</span>
      </div>
      <div class="result-card-snippet">…${highlightHTML(h.snippet, h.matched)}…${h.full ? "" : partialWarningHTML(h)}</div>
      <div class="result-card-actions">
        <button class="result-card-open" data-goto-result="${h.page}">
          <i class="fa-solid fa-arrow-right"></i> Open page ${h.page}
        </button>
        <button class="result-card-share" data-share-result="${h.page}" title="Share">
          <i class="fa-solid fa-share-nodes"></i>
        </button>
      </div>
    </div>`).join("");
}

// Open a result: push a history entry so browser Back returns to the results.
function openFromResults(p) {
  cameFromSearch = true;
  setUrl({ page: p, q: query, from: "search" }, "push");
  pushedFromResults = true;
  go(p, { syncUrl: false });
}

// ============================================================
// SEARCH INPUT WIRING
// ============================================================
const searchInput = $("viewerSearch");
const clearBtn = $("clearSearch");

function clearSearch() {
  if (searchInput) searchInput.value = "";
  query = "";
  lastHits = null; lastHitsQuery = "";
  cameFromSearch = false; pushedFromResults = false;
  searchToken++;
  saveSearchState();
  if (clearBtn) clearBtn.style.display = "none";
  $("didYouMean")?.classList.add("hidden");
  clearHighlights();
  setUrl({ page: currentPage }, "replace");
  showPdfView();
  if (pdf) go(currentPage, { syncUrl: false });
}

if (searchInput) {
  searchInput.value = query;
  if (query && clearBtn) clearBtn.style.display = "inline-flex";

  searchInput.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (clearBtn) clearBtn.style.display = v ? "inline-flex" : "none";

    clearTimeout(searchTimer);
    if (!v) { clearSearch(); return; }
    cameFromSearch = false;
    searchTimer = setTimeout(() => runSearch(v), 350);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = e.target.value.trim();
      clearTimeout(searchTimer);
      if (isNumeric(v)) {
        query = "";
        go(parseInt(v, 10));
      } else if (v) {
        runSearch(v);
      }
    }
  });
}

clearBtn?.addEventListener("click", clearSearch);

// ============================================================
// BACK BUTTONS
// ============================================================
// "Back to PDF" on the results view just toggles the view; the query and results are kept.
$("backToPdfBtn")?.addEventListener("click", () => {
  showPdfView();
  go(currentPage);
});

// "← Back to results" in the PDF view
$("backToResults")?.addEventListener("click", goBackToResults);

// Library buttons: with an active search on a page they go back to the results first.
document.querySelectorAll("[data-lib]").forEach(a => {
  a.addEventListener("click", (e) => {
    const onPdf = !$("pdfView")?.classList.contains("hidden");
    if (onPdf && query && !isNumeric(query) && (cameFromSearch || resultsAvailable())) {
      e.preventDefault();
      goBackToResults();
    }
  });
});

// Browser Back / Forward
window.addEventListener("popstate", async () => {
  if (!pdf) return;
  const sp = new URLSearchParams(location.search);
  const pg = parseInt(sp.get("page") || "0", 10);
  query = (sp.get("q") || "").trim();
  cameFromSearch = sp.get("from") === "search";
  if (searchInput) searchInput.value = query;
  if (clearBtn) clearBtn.style.display = query ? "inline-flex" : "none";

  if (pg) {
    await go(pg, { syncUrl: false });
  } else if (query) {
    pushedFromResults = false;
    await showResults();
  } else {
    clearHighlights();
    showPdfView();
    await go(currentPage, { syncUrl: false });
  }
});

// ============================================================
// GLOBAL CLICKS
// ============================================================
document.addEventListener("click", (e) => {
  // Suggestion from "Did you mean…?"
  const sug = e.target.closest("[data-suggest]");
  if (sug) {
    const v = sug.dataset.suggest;
    if (searchInput) searchInput.value = v;
    if (clearBtn) clearBtn.style.display = "inline-flex";
    runSearch(v);
    return;
  }

  // Open result page
  const gotoResult = e.target.closest("[data-goto-result]");
  if (gotoResult) {
    const p = parseInt(gotoResult.dataset.gotoResult, 10);
    if (isNumeric(query)) { query = ""; if (searchInput) searchInput.value = ""; if (clearBtn) clearBtn.style.display = "none"; go(p); return; }
    if (clearBtn) clearBtn.style.display = "inline-flex";
    openFromResults(p);
    return;
  }

  // Share a result
  const shareResult = e.target.closest("[data-share-result]");
  if (shareResult) {
    const p = parseInt(shareResult.dataset.shareResult, 10);
    const url = `${location.origin}${location.pathname}?doc=${encodeURIComponent(docId)}&page=${p}&q=${encodeURIComponent(query)}`;
    openShareModal(`Page ${p}: "${query}"`, url);
    return;
  }

  // Sidebar: jump to bookmark/history
  const goto = e.target.closest("[data-goto]");
  if (goto) { go(parseInt(goto.dataset.goto, 10)); return; }

  // Remove bookmark
  const rm = e.target.closest("[data-rm]");
  if (rm) {
    const p = parseInt(rm.dataset.rm, 10);
    bookmarks = bookmarks.filter(b => b !== p);
    renderBookmarks();
    setDoc(doc(db, "users", U.uid, "bookmarks", docId), { docId, pages: bookmarks, updatedAt: Date.now() }).catch(console.error);
    return;
  }
});

// ============================================================
// CONTROLS
// ============================================================
$("prevPage")?.addEventListener("click", () => go(currentPage - 1));
$("nextPage")?.addEventListener("click", () => go(currentPage + 1));
$("pageNum")?.addEventListener("keydown", (e) => { if (e.key === "Enter") go(e.target.value); });

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if ($("resultsView") && !$("resultsView").classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") go(currentPage - 1);
  if (e.key === "ArrowRight") go(currentPage + 1);
});

// ============================================================
// BOOKMARK TOGGLE
// ============================================================
$("addBm")?.addEventListener("click", async () => {
  if (!U || !docId) return;
  const p = currentPage;
  if (bookmarks.includes(p)) {
    bookmarks = bookmarks.filter(b => b !== p);
    toast(`Removed bookmark on page ${p}`);
  } else {
    bookmarks.push(p);
    toast(`Bookmarked page ${p}`);
  }
  renderBookmarks();
  try {
    await setDoc(doc(db, "users", U.uid, "bookmarks", docId), { docId, pages: bookmarks, updatedAt: Date.now() });
  } catch (e) { console.error(e); toast("Could not save bookmark"); }
});

// ============================================================
// READER AID
// ============================================================
function applyReaderAid() {
  document.documentElement.style.setProperty("--text-scale", textScale);
}
$("rZoomUp")?.addEventListener("click", () => { zoom = Math.min(3, zoom + 0.15); go(currentPage, { syncUrl: false }); });
$("rZoomDown")?.addEventListener("click", () => { zoom = Math.max(0.6, zoom - 0.15); go(currentPage, { syncUrl: false }); });
$("rTextUp")?.addEventListener("click", () => { textScale = Math.min(1.6, +(textScale + 0.1).toFixed(2)); applyReaderAid(); go(currentPage, { syncUrl: false }); });
$("rTextDown")?.addEventListener("click", () => { textScale = Math.max(0.8, +(textScale - 0.1).toFixed(2)); applyReaderAid(); go(currentPage, { syncUrl: false }); });
document.querySelectorAll("[data-contrast]").forEach(b => {
  b.onclick = () => {
    document.documentElement.dataset.contrast = b.dataset.contrast;
    document.querySelectorAll("[data-contrast]").forEach(x => x.classList.toggle("active", x === b));
  };
});
$("rReset")?.addEventListener("click", () => {
  zoom = 1.3; textScale = 1;
  document.documentElement.dataset.contrast = "normal";
  document.querySelectorAll("[data-contrast]").forEach(x => x.classList.toggle("active", x.dataset.contrast === "normal"));
  applyReaderAid();
  go(currentPage, { syncUrl: false });
  toast("Reader aid reset");
});

// ============================================================
// SHARE
// ============================================================
function openShareModal(text, url) {
  const modal = $("shareModal"), btns = $("shareBtns");
  const enc = encodeURIComponent;
  btns.innerHTML = `
    <a class="btn social" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(text + " " + url)}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
    <a class="btn social" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}"><i class="fa-brands fa-x-twitter"></i> X</a>
    <a class="btn social" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}"><i class="fa-brands fa-facebook"></i> Facebook</a>
    <button class="btn social" id="copyShare"><i class="fa-solid fa-link"></i> Copy link</button>
  `;
  modal.classList.remove("hidden");
  $("copyShare").onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { toast("Could not copy"); }
  };
}
$("shareView")?.addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?doc=${encodeURIComponent(docId)}&page=${currentPage}` +
    (query && !isNumeric(query) ? `&q=${encodeURIComponent(query)}` : "");
  openShareModal("Check this page", url);
});
$("shareClose")?.addEventListener("click", () => $("shareModal")?.classList.add("hidden"));

// ============================================================
// DRAWER
// ============================================================
function openDrawer() {
  $("drawer")?.classList.add("open");
  $("backdrop")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  $("drawer")?.classList.remove("open");
  $("backdrop")?.classList.add("hidden");
  document.body.style.overflow = "";
}
$("menuBtn")?.addEventListener("click", openDrawer);
$("drawerClose")?.addEventListener("click", closeDrawer);
$("backdrop")?.addEventListener("click", closeDrawer);

// ============================================================
// WEBIFY — redirect to webify.html (with premium gate)
// ============================================================
$("wfyBtn")?.addEventListener("click", () => {
  if (!docId) { toast("Open a document first."); return; }
  if (!premium) {
    document.getElementById("webifyGateModal")?.classList.remove("hidden");
    return;
  }
  location.href = `webify.html?docId=${encodeURIComponent(docId)}`;
});

document.getElementById("webifyGateClose")?.addEventListener("click", () => {
  document.getElementById("webifyGateModal")?.classList.add("hidden");
});

document.getElementById("webifyGateUpgrade")?.addEventListener("click", (e) => {
  e.preventDefault();
  const returnTo = `webify.html?docId=${encodeURIComponent(docId)}`;
  location.href = `pricing.html?return=${encodeURIComponent(returnTo)}`;
});
