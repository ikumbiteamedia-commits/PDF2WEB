// js/app.js
// Workspace logic for app.html.
// Decisions: drawer/nav wiring lives in js/nav.js (shared with tools.html); file sizes use formatBytes()
// from js/util.js; PDFs for search come from the IndexedDB-backed cache in js/pdf-cache.js.

import { auth, db, storage } from "./firebase.js";
import { watchUser, logOut } from "./auth.js";
import { watchDocs, upload, FREE_UPLOADS } from "./documents.js";
import {
  collection, doc, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref as sRef, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initNav, closeDrawer, profileHTML, isPremium } from "./nav.js";
import { getPdfBlob, putCached, removeCached } from "./pdf-cache.js";
import {
  formatBytes, esc, splitQuery, matchPage, highlightHTML, sortHits,
  partialWarningHTML, matchBadgeHTML, SEARCH_CSS, injectStyles
} from "./util.js";
import "./webify.js";
import "./admin.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

injectStyles("pdf2web-search-css", SEARCH_CSS);

const $ = id => document.getElementById(id);

export const S = {
  U: null, P: null, DOCS: [], premium: false, currentDocId: null,
  show: () => {}, toast: () => {}, share: () => {}, pricing: () => {}, curDoc: () => null
};

let U = null, P = null, DOCS = [], unDocs = () => {};

const premium = () => isPremium(P);

function toast(m) {
  const t = $("toast");
  if (!t) return;
  t.textContent = m;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function show(v) {
  document.querySelectorAll("main section").forEach(s => s.classList.add("hidden"));
  const target = $("view-" + v);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === v)
  );
  closeDrawer();
  scrollTo(0, 0);
}

// Views can be deep-linked from other pages (e.g. tools.html drawer -> app.html#library)
function initialView() {
  const v = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  return v && $("view-" + v) ? v : "home";
}

function render() {
  S.U = U; S.P = P; S.DOCS = DOCS; S.premium = premium();
  S.show = show; S.toast = toast;
  S.share = (url, title) => {
    const modal = $("shareModal"), btns = $("shareBtns");
    if (!modal || !btns) return;
    const enc = encodeURIComponent;
    const t = enc(title || "Check this out");
    btns.innerHTML = `
      <a class="btn social" target="_blank" rel="noopener" href="https://wa.me/?text=${t}%20${enc(url)}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
      <a class="btn social" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${t}&url=${enc(url)}"><i class="fa-brands fa-x-twitter"></i> X (Twitter)</a>
      <a class="btn social" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}"><i class="fa-brands fa-facebook"></i> Facebook</a>
      <button class="btn social" id="copyShare"><i class="fa-solid fa-link"></i> Copy link</button>`;
    modal.classList.remove("hidden");
    $("copyShare").onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Link copied"); }
      catch { toast("Could not copy"); }
    };
  };
  S.pricing = (msg) => {
    const note = $("payNote");
    if (note && msg) note.textContent = msg;
    $("payModal")?.classList.remove("hidden");
  };
  S.curDoc = () => DOCS.find(d => d.id === S.currentDocId) || null;
  queueMicrotask(() => document.dispatchEvent(new Event("aafa:render")));

  $("authModal")?.classList.add("hidden");
  if (!U) return;

  if ($("sideProfile")) $("sideProfile").innerHTML = profileHTML(U, P);
  if ($("drawerProfile")) $("drawerProfile").innerHTML = profileHTML(U, P);
  if ($("uploadHint")) {
    $("uploadHint").textContent = premium()
      ? "Premium: unlimited uploads"
      : `Free plan: ${P?.uploadCount || 0} / ${FREE_UPLOADS} PDF uploads used`;
  }

  const g = DOCS.length
    ? DOCS.map(d => `<div class="card" style="cursor:default">
        <div class="cover" data-open="${esc(d.id)}" style="cursor:pointer"><i class="fa-solid fa-file-lines"></i></div>
        <h3>${esc(d.displayName || "Untitled")}</h3>
        <p class="meta">${formatBytes(d.size || 0)} · ${esc(d.status || "")}</p>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="btn primary" data-open="${esc(d.id)}" style="flex:1;justify-content:center"><i class="fa-solid fa-book-open"></i> Open PDF</span>
          <button class="btn" data-del="${esc(d.id)}" title="Delete"
                  style="padding:10px 14px;color:var(--danger);border-color:var(--danger)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>`).join("")
    : `<div class="empty">
        <i class="fa-solid fa-inbox"></i>
        <b>No documents yet</b>
        <div>Upload your first PDF to start building your library.</div>
      </div>`;
  if ($("libGrid")) $("libGrid").innerHTML = g;
  if ($("libGrid2")) $("libGrid2").innerHTML = g;

  const sel = $("sScope");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML = `<option value="">All documents</option>` +
      DOCS.map(d => `<option value="${esc(d.id)}">${esc(d.displayName || "Untitled")}</option>`).join("");
    if (keep) sel.value = keep;
  }
}

let firstLoad = true;
watchUser((u, p) => {
  U = u; P = p;
  unDocs();
  if (u) {
    unDocs = watchDocs(d => { DOCS = d; render(); });
    if (firstLoad) {
      show(initialView());
      firstLoad = false;
      // Query handed over from the header search on another page (e.g. tools.html)
      let pending = null;
      try { pending = sessionStorage.getItem("pdf2web_pending_search"); sessionStorage.removeItem("pdf2web_pending_search"); } catch {}
      if (pending) {
        show("search");
        if ($("sInput")) $("sInput").value = pending;
        setTimeout(() => runSearch(pending, null), 300);   // wait for DOCS to arrive
      }
    }
  } else {
    location.replace("index.html");
    return;
  }
  render();
});

// Shared nav: drawer, [data-nav] links
initNav({ onNavigate: show });

// ============================================================
// SEARCH — multi-word (AND, with partial-match feedback)
// ============================================================
const pdfDocCache = new Map();    // docId -> Promise<PDFDocumentProxy>
const pageTextCache = new Map();  // docId -> Promise<string[]>  (index = pageNumber - 1)
let searchToken = 0;

function getPdfDoc(d) {
  if (!pdfDocCache.has(d.id)) {
    const p = (async () => {
      const blob = await getPdfBlob(U.uid, d.id, [d.storagePath]);
      const data = new Uint8Array(await blob.arrayBuffer());
      return pdfjsLib.getDocument({ data }).promise;
    })();
    p.catch(() => pdfDocCache.delete(d.id));
    pdfDocCache.set(d.id, p);
  }
  return pdfDocCache.get(d.id);
}

function getPagesText(d) {
  if (!pageTextCache.has(d.id)) {
    const p = (async () => {
      const pdf = await getPdfDoc(d);
      const out = new Array(pdf.numPages).fill("");
      const BATCH = 6;
      for (let start = 1; start <= pdf.numPages; start += BATCH) {
        const jobs = [];
        for (let n = start; n < start + BATCH && n <= pdf.numPages; n++) {
          jobs.push((async () => {
            const page = await pdf.getPage(n);
            const tc = await page.getTextContent();
            out[n - 1] = tc.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim();
          })());
        }
        await Promise.all(jobs);
      }
      return out;
    })();
    p.catch(() => pageTextCache.delete(d.id));
    pageTextCache.set(d.id, p);
  }
  return pageTextCache.get(d.id);
}

async function runSearch(q, docIdFilter) {
  const results = $("sResults");
  if (!results) return;

  q = (q || "").trim();
  if (q.length < 2) {
    results.innerHTML = '<p class="meta">Type at least 2 characters.</p>';
    return;
  }

  const token = ++searchToken;
  results.innerHTML = '<p class="meta"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</p>';

  const docs = docIdFilter ? DOCS.filter(d => d.id === docIdFilter) : DOCS;
  const numeric = /^\d+$/.test(q);
  const words = splitQuery(q);   // words >= 2 chars, lower-cased
  const hits = [];

  if (!numeric && !words.length) {
    results.innerHTML = '<p class="meta">Type at least one word of 2 or more characters.</p>';
    return;
  }

  for (const d of docs) {
    try {
      if (numeric) {
        const pdf = await getPdfDoc(d);
        if (token !== searchToken) return;
        const p = parseInt(q, 10);
        if (p >= 1 && p <= pdf.numPages) {
          hits.push({
            docId: d.id, docName: d.displayName || "Untitled", docSize: d.size || 0,
            page: p, jump: true, full: true, matched: [], missing: [], total: 0,
            snippet: `Jump to page ${p}.`
          });
        }
        continue;
      }

      const texts = await getPagesText(d);
      if (token !== searchToken) return;
      texts.forEach((text, i) => {
        if (!text) return;
        const m = matchPage(text, words);
        if (!m) return;
        hits.push({
          docId: d.id, docName: d.displayName || "Untitled", docSize: d.size || 0,
          page: i + 1, ...m
        });
      });
    } catch (e) {
      console.error("Search error for doc", d.id, e);
    }
  }
  if (token !== searchToken) return;

  if (!hits.length) {
    results.innerHTML = `<div class="empty">
      <i class="fa-solid fa-magnifying-glass"></i>
      <b>No matches found</b>
      <div>${numeric ? "That page number doesn't exist in the selected document(s)." : "None of those words appear in the selected document(s). Try other keywords."}</div>
    </div>`;
    return;
  }

  sortHits(hits);
  const shown = hits.slice(0, 60);
  const fullCount = hits.filter(h => h.full).length;
  const partialCount = hits.length - fullCount;

  const summary = numeric ? "" : `
    <p class="meta" style="margin-bottom:12px">
      ${hits.length} page${hits.length === 1 ? "" : "s"} found for “${esc(q)}” —
      ${fullCount} with all words${partialCount ? `, ${partialCount} partial` : ""}${hits.length > shown.length ? ` · showing first ${shown.length}` : ""}.
    </p>`;

  results.innerHTML = summary + shown.map(h => {
    const snippetHTML = h.jump ? esc(h.snippet) : "…" + highlightHTML(h.snippet, h.matched) + "…";
    const viewerUrl = `viewer.html?doc=${encodeURIComponent(h.docId)}&page=${h.page}` +
      (numeric ? "" : `&q=${encodeURIComponent(q)}&from=search`);
    const shareUrl = location.origin + "/" + viewerUrl;
    const shareText = numeric ? `Page ${h.page}` : `"${q}" on page ${h.page}`;

    return `
      <div class="search-hit">
        <div class="search-hit-head">
          <b><i class="fa-solid fa-file-lines"></i> ${esc(h.docName)} <span class="meta" style="font-weight:600">· ${formatBytes(h.docSize)}</span></b>
          <span class="head-right">
            ${h.jump ? "" : matchBadgeHTML(h)}
            <span class="page-tag">Page ${h.page}</span>
          </span>
        </div>
        <div class="search-hit-snippet">${snippetHTML}${h.jump || h.full ? "" : partialWarningHTML(h)}</div>
        <div class="search-hit-actions">
          <a class="btn primary" href="${viewerUrl}">
            <i class="fa-solid fa-arrow-right"></i> View page
          </a>
          <a class="btn share-icon" target="_blank" rel="noopener"
             href="https://wa.me/?text=${encodeURIComponent(`${shareText}: ${shareUrl}`)}"
             title="Share on WhatsApp">
            <i class="fa-brands fa-whatsapp"></i>
          </a>
          <a class="btn share-icon" target="_blank" rel="noopener"
             href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}"
             title="Share on X">
            <i class="fa-brands fa-x-twitter"></i>
          </a>
          <a class="btn share-icon" target="_blank" rel="noopener"
             href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}"
             title="Share on Facebook">
            <i class="fa-brands fa-facebook"></i>
          </a>
          <button class="btn share-icon" data-copy="${esc(shareUrl)}" title="Copy link">
            <i class="fa-solid fa-link"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

let searchTimer = null;
$("sInput")?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => {
    runSearch(q, $("sScope")?.value || null);
  }, 450);
});
$("sScope")?.addEventListener("change", () => {
  const q = $("sInput")?.value?.trim();
  if (q) runSearch(q, $("sScope")?.value || null);
});

// Header search box (desktop) -> jumps to the Search view and runs the query
$("hSearch")?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const v = e.target.value.trim();
  if (!v) return;
  show("search");
  if ($("sInput")) $("sInput").value = v;
  runSearch(v, $("sScope")?.value || null);
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast("Link copied");
  } catch {
    toast("Could not copy");
  }
});

// ============================================================
// GLOBAL CLICK HANDLER — delete, open (nav is handled by nav.js)
// ============================================================
document.addEventListener("click", async e => {
  // DELETE
  const delBtn = e.target.closest("[data-del]");
  if (delBtn) {
    const id = delBtn.dataset.del;
    const d = DOCS.find(x => x.id === id);
    if (!confirm(`Delete "${d?.displayName || "this PDF"}"? This can't be undone.`)) return;

    try {
      // 1. Delete pages subcollection docs
      const pagesSnap = await getDocs(collection(db, "users", U.uid, "documents", id, "pages"));
      const batch = writeBatch(db);
      pagesSnap.forEach(p => batch.delete(p.ref));
      // 2. Delete the document itself
      batch.delete(doc(db, "users", U.uid, "documents", id));
      await batch.commit();

      // 3. Delete Storage file
      try {
        const path = d?.storagePath || `users/${U.uid}/documents/${id}/original.pdf`;
        await deleteObject(sRef(storage, path));
      } catch (sErr) {
        console.warn("Storage delete skipped:", sErr?.message);
      }

      // 4. Drop local caches
      removeCached(`${U.uid}:${id}`);
      pdfDocCache.delete(id);
      pageTextCache.delete(id);

      toast("Document deleted");
    } catch (err) {
      console.error(err);
      toast("Couldn't delete — " + (err.message || "try again"));
    }
    return;
  }

  // OPEN
  const openEl = e.target.closest("[data-open]");
  if (openEl) {
    const id = openEl.dataset.open;
    location.href = `viewer.html?doc=${encodeURIComponent(id)}`;
    return;
  }

  if (e.target.closest("[data-pricing]")) { show("pricing"); return; }
});

// ============================================================
// LOGOUT
// ============================================================
$("logoutBtn")?.addEventListener("click", async () => {
  await logOut();
  location.replace("index.html");
});

// ============================================================
// UPLOAD — loader stays here (first upload only)
// ============================================================
async function doUpload(f) {
  if (!f || !/pdf$/i.test(f.type || f.name)) return toast("Please choose a PDF file");
  if (!premium() && (P?.uploadCount || 0) >= FREE_UPLOADS) {
    $("uploadHint") && ($("uploadHint").textContent =
      "You've used your 2 free uploads. Upgrade to Premium to upload unlimited documents.");
    return;
  }
  const { task, done } = upload(f, pct => {
    if ($("upBar")) $("upBar").style.width = Math.round(pct * 100) + "%";
  });
  $("upWrap")?.classList.remove("hidden");
  if ($("cancelUp")) $("cancelUp").onclick = () => task.cancel();
  try {
    const newId = await done;
    putCached(`${U.uid}:${newId}`, f);   // first open of this PDF is then instant
    toast("Uploaded");
  }
  catch (err) {
    console.error(err);
    toast(err.code === "storage/canceled" ? "Upload cancelled" : "Upload failed");
  }
  $("upWrap")?.classList.add("hidden");
}
$("chooseBtn")?.addEventListener("click", () => $("fileInput").click());
$("fileInput")?.addEventListener("change", e => { doUpload(e.target.files[0]); e.target.value = ""; });
const z = $("uploadZone");
if (z) {
  ["dragenter", "dragover"].forEach(v => z.addEventListener(v, e => { e.preventDefault(); z.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(v => z.addEventListener(v, e => { e.preventDefault(); z.classList.remove("drag"); }));
  z.addEventListener("drop", e => doUpload(e.dataTransfer.files[0]));
}

// ============================================================
// SHARE MODAL CLOSE
// ============================================================
$("shareClose")?.addEventListener("click", () => $("shareModal")?.classList.add("hidden"));
