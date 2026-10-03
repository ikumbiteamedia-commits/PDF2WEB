// js/webify.js
// Webify flow — landing (docs + drafts + published) → generation → inline CMS editor
// No template picker. Click a document, we generate the site, you edit.

import { auth, db, storage, fns } from "./firebase.js";
import {
  collection, query, where, getDocs, doc, getDoc,
  updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { formatBytes } from "./util.js";
import {
  ref as sRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// ============================================================
// SHORTCUTS
// ============================================================
const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const call = n => httpsCallable(fns, n);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let documents = [];
let sites = [];
let selectedDoc = null;
let currentSiteId = null;
let currentSite = null;
let selectedSectionId = null;
let savedSnapshot = "";
let saveTimer = null;
let pendingImageInsert = null;
let pendingLinkRange = null;

// ============================================================
// INIT
// ============================================================
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    const p = $("webifyDocPicker");
    if (p) p.innerHTML = `<p class="meta" style="grid-column:1/-1;text-align:center">
      Please <a href="index.html" style="color:var(--primary);font-weight:700">sign in</a> to webify documents.
    </p>`;
    return;
  }

  const params = new URLSearchParams(location.search);
  const siteId = params.get("siteId");
  const docId = params.get("docId");

  if (siteId) { await openEditorForSite(siteId); return; }

  await Promise.all([loadDocuments(), loadSites()]);
  wireLanding();

  if (docId) {
    const loaded = await loadSingleDoc(docId);
    if (loaded && loaded !== false) { await selectDocument(docId); return; }
    if (loaded === false) toast("That document isn't ready yet.", 3500, "error");
    else toast("We couldn't find that document.", 3500, "error");
  }

  showSection("landing");
});

// ============================================================
// HELPERS
// ============================================================
function toast(msg, ms = 2600, kind) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "wf-toast";
  if (kind === "error") t.classList.add("error");
  if (kind === "success") t.classList.add("success");
  t.classList.add("__show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("__show"), ms);
}

function showSection(name) {
  $("webifyLanding")?.classList.toggle("hidden", name !== "landing");
  $("webifyEditor")?.classList.toggle("hidden", name !== "editor");
}

// ============================================================
// LANDING — documents
// ============================================================
async function loadDocuments() {
  const picker = $("webifyDocPicker");
  if (!picker) return;
  picker.innerHTML = `<p class="meta" style="grid-column:1/-1;text-align:center">Loading your documents…</p>`;

  try {
    const q = query(collection(db, `users/${currentUser.uid}/documents`), where("status", "==", "ready"));
    const snap = await getDocs(q);
    documents = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

    if (!documents.length) {
      picker.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <i class="fa-solid fa-file-circle-plus"></i>
          <p class="meta">No ready documents yet. Upload a PDF first.</p>
          <a class="btn primary" href="app.html"><i class="fa-solid fa-upload"></i> Go to Library</a>
        </div>`;
      return;
    }

    picker.innerHTML = documents.map(d => `
      <button class="wf-doc-card" data-id="${d.id}">
        <div class="wf-doc-card-icon"><i class="fa-solid fa-file-pdf"></i></div>
        <b>${esc(d.displayName || "Untitled PDF")}</b>
        <p class="meta">${d.pages || "?"} pages · ${formatBytes(d.size || 0)} · ${d.toc?.length || 0} headings</p>
        <span class="btn primary" style="margin-top:auto;justify-content:center;pointer-events:none">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Convert to website
        </span>
      </button>
    `).join("");
  } catch (err) {
    console.error(err);
    picker.innerHTML = `<p class="meta" style="grid-column:1/-1;text-align:center;color:var(--danger)">
      We couldn't load your documents. Refresh and try again.
    </p>`;
  }
}

// ============================================================
// LANDING — drafts + published
// ============================================================
async function loadSites() {
  try {
    const snap = await getDocs(collection(db, `users/${currentUser.uid}/websites`));
    sites = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  } catch (err) {
    console.error("loadSites failed:", err);
    sites = [];
  }
  renderSites();
}

function renderSites() {
  const drafts = sites.filter(s => s.status !== "published");
  const published = sites.filter(s => s.status === "published");

  $("draftsCount").textContent = drafts.length;
  $("publishedCount").textContent = published.length;

  const draftsGrid = $("draftsGrid");
  const publishedGrid = $("publishedGrid");

  if (draftsGrid) {
    draftsGrid.innerHTML = drafts.length
      ? drafts.map(renderSiteCard).join("")
      : `<div class="wf-empty" style="grid-column:1/-1">
           <i class="fa-solid fa-inbox"></i>
           <b>No drafts yet</b>
           Pick a document above to start a new site.
         </div>`;
  }
  if (publishedGrid) {
    publishedGrid.innerHTML = published.length
      ? published.map(renderSiteCard).join("")
      : `<div class="wf-empty" style="grid-column:1/-1">
           <i class="fa-solid fa-rocket"></i>
           <b>Nothing published yet</b>
           Publish a draft to make it live.
         </div>`;
  }
}

function renderSiteCard(s) {
  const isPub = s.status === "published";
  const views = s.views || 0;
  const updated = s.updatedAt?.toDate?.();
  const updatedStr = updated ? updated.toLocaleDateString() : "just now";
  const url = isPub ? `${location.origin}/webify/${s.slug || ""}` : "";

  return `
    <div class="wf-site-card" data-site="${s.id}">
      <div class="head">
        <div class="thumb"><i class="fa-solid fa-globe"></i></div>
        <div class="info">
          <h4>${esc(s.title || "Untitled")}</h4>
          <div class="slug">${isPub ? esc(s.slug || "") : "draft · not published"}</div>
        </div>
      </div>
      <div>
        <span class="badge ${isPub ? "published" : "draft"}">
          <i class="fa-solid ${isPub ? "fa-circle-check" : "fa-pen"}"></i>
          ${isPub ? "Published" : "Draft"}
        </span>
      </div>
      <div class="stats">
        <span><i class="fa-solid fa-clock"></i> ${updatedStr}</span>
        ${isPub ? `<span><i class="fa-solid fa-eye"></i> ${views} views</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn primary" data-open="${s.id}">
          <i class="fa-solid fa-pen-to-square"></i> ${isPub ? "Edit" : "Continue"}
        </button>
        ${isPub
          ? `<a class="btn" href="${url}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> View</a>
             <button class="btn" data-share="${s.id}"><i class="fa-solid fa-share-nodes"></i> Share</button>`
          : `<button class="btn" data-delete="${s.id}"><i class="fa-solid fa-trash"></i></button>`
        }
      </div>
    </div>
  `;
}

function wireLanding() {
  // Document picker — click a doc card → generate
  $("webifyDocPicker")?.addEventListener("click", e => {
    const card = e.target.closest("[data-id]");
    if (card) selectDocument(card.dataset.id);
  });

  // Site card actions
  document.body.addEventListener("click", async e => {
    const openBtn = e.target.closest("[data-open]");
    if (openBtn) { await openEditorForSite(openBtn.dataset.open); return; }

    const delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      if (!confirm("Delete this draft? This can't be undone.")) return;
      try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/websites`, delBtn.dataset.delete));
        toast("Draft deleted", 2200, "success");
        await loadSites();
      } catch (err) {
        console.error(err);
        toast("Couldn't delete draft", 2600, "error");
      }
      return;
    }

    const shareBtn = e.target.closest("[data-share]");
    if (shareBtn) {
      const s = sites.find(x => x.id === shareBtn.dataset.share);
      if (!s) return;
      const url = `${location.origin}/webify/${s.slug || ""}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copied", 1800, "success");
      } catch {
        prompt("Copy this link:", url);
      }
      return;
    }
  });
}

// ============================================================
// LOAD SINGLE DOC (from viewer)
// ============================================================
async function loadSingleDoc(docId) {
  try {
    const snap = await getDoc(doc(db, `users/${currentUser.uid}/documents`, docId));
    if (!snap.exists()) return null;
    const d = { id: snap.id, ...snap.data() };
    if (d.status !== "ready") return false;
    documents = [d];
    return d;
  } catch (err) {
    console.error("loadSingleDoc failed:", err);
    return null;
  }
}

// ============================================================
// SELECT DOCUMENT → GENERATE → OPEN EDITOR (no picker)
// ============================================================
async function selectDocument(docId) {
  selectedDoc = documents.find(d => d.id === docId);
  if (!selectedDoc) return;

  // If a draft already exists for this document, offer to continue
  const existing = sites.find(s => s.documentId === docId && s.status !== "published");
  if (existing) {
    const cont = confirm(`You already have a draft for "${selectedDoc.displayName}". Continue editing it?`);
    if (cont) { await openEditorForSite(existing.id); return; }
  }

  toast(`Generating your website…`, 20000);

  try {
    const res = await call("webifyDocument")({
      docId: selectedDoc.id,
      template: "classic"
    });
    await openEditorForSite(res.data.id);
  } catch (err) {
    console.error(err);
    toast(err?.message || "Couldn't generate the website. Please try again.", 4000, "error");
  }
}

// ============================================================
// EDITOR — OPEN
// ============================================================
async function openEditorForSite(siteId) {
  currentSiteId = siteId;
  showSection("editor");
  $("canvas").innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-light)">
    <i class="fa-solid fa-spinner fa-spin" style="font-size:28px"></i>
    <p style="margin-top:12px">Loading editor…</p>
  </div>`;

  try {
    const snap = await getDoc(doc(db, `users/${currentUser.uid}/websites`, siteId));
    if (!snap.exists()) { toast("Site not found", 2600, "error"); showSection("landing"); return; }
    currentSite = { id: snap.id, ...snap.data() };
    if (!currentSite.colors) currentSite.colors = {};
    if (!Array.isArray(currentSite.sections)) currentSite.sections = [];

    savedSnapshot = JSON.stringify(currentSite);
    selectedSectionId = null;

    renderEditorChrome();
    renderCanvas();
    renderSectionList();
    renderContextPanel();
    wireEditor();
    setEditorStatus("saved");

    history.replaceState(null, "", `webify.html?siteId=${siteId}`);
  } catch (err) {
    console.error(err);
    toast("Couldn't load the editor", 2600, "error");
    showSection("landing");
  }
}

function renderEditorChrome() {
  $("editorTitle").textContent = currentSite.title || "Untitled";
  $("pageTitle").value = currentSite.title || "";
  $("pageHero").value = currentSite.hero || "";
  $("pageSlug").value = currentSite.slug || "";

  const colors = currentSite.colors || {};
  $("colorPrimary").value = colors.primary || "#1e6b3a";
  $("colorBg").value = colors.bg || "#f4f9f6";
  $("colorText").value = colors.text || "#16211c";
}

// ============================================================
// EDITOR — CANVAS
// ============================================================
function renderCanvas() {
  const canvas = $("canvas");
  if (!canvas) return;

  const s = currentSite;
  const colors = s.colors || {};
  const primary = colors.primary || "#1e6b3a";
  const bg = colors.bg || "#f4f9f6";
  const text = colors.text || "#16211c";

  const sections = (s.sections || []).filter(x => !x.hidden);
  const title = s.title || "";
  const subtitle = s.subtitle || "";
  const hero = s.hero || "";

  canvas.innerHTML = `
    <div class="__site" style="
      --p:${primary};
      --bg:${bg};
      --text:${text};
      --p-bg:${lighten(primary, .9)};
      --p-dark:${darken(primary, .2)};
      --border:#e2ece6;
      --surface:#ffffff;
      --black:#0f1a14;
      --red:#dc3545;
      --text-soft:#4d5f57;
      --text-light:#8a9f95;
      --font:'Quicksand',sans-serif;
      font-family:'Quicksand',sans-serif;
      background:${bg};
      color:${text};
      min-height:100%;
    ">
      <style>
        .__site * { box-sizing: border-box; }
        .__site .__topbar {
          background: #0f1a14; color: #fff;
          padding: 14px 24px; display: flex; align-items: center; gap: 12px;
        }
        .__site .__topbar b { font-size: 14px; font-weight: 800; }
        .__site .__topbar .__mark {
          width: 28px; height: 28px; border-radius: 8px;
          background: var(--p); color: #fff;
          display: flex; align-items: center; justify-content: center; font-size: 12px;
        }
        .__site .__hero {
          padding: 56px 24px 40px; text-align: center;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
        }
        .__site .__hero h1 {
          font-size: clamp(26px, 4vw, 42px); font-weight: 800;
          letter-spacing: -1px; margin-bottom: 12px; color: var(--text);
        }
        .__site .__hero .__subtitle {
          font-size: 17px; color: var(--p-dark); font-weight: 600;
          max-width: 640px; margin: 0 auto 12px;
        }
        .__site .__hero p {
          font-size: 14.5px; color: var(--text-soft);
          max-width: 520px; margin: 0 auto 20px;
        }
        .__site .__kicker {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--p-bg); color: var(--p);
          padding: 6px 14px; border-radius: 999px;
          font-size: 10.5px; font-weight: 800; letter-spacing: 1.2px;
          text-transform: uppercase; margin-bottom: 16px;
        }
        .__site .__cta-row {
          display: inline-flex; gap: 8px; flex-wrap: wrap; justify-content: center;
        }
        .__site .__btn-primary, .__site .__btn-secondary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 11px 22px; border-radius: 999px;
          font-size: 13.5px; font-weight: 800;
        }
        .__site .__btn-primary { background: var(--p); color: #fff; }
        .__site .__btn-secondary {
          background: var(--surface); color: var(--p-dark);
          border: 1.5px solid var(--border);
        }
        .__site .__body {
          max-width: 900px; margin: 0 auto;
          padding: 28px 20px 60px;
        }
        .__site .__section {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 16px; padding: 26px 28px;
          margin-bottom: 16px;
          transition: box-shadow .15s, outline-color .15s;
          outline: 1px dashed transparent; outline-offset: 4px;
          cursor: pointer; position: relative;
        }
        .__site .__section:hover { outline-color: rgba(30,107,58,.35); }
        .__site .__section.__sel {
          outline: 2px solid var(--p); outline-offset: 4px;
          box-shadow: 0 0 0 6px var(--p-bg);
        }
        .__site .__section h2 {
          font-size: clamp(18px, 2.4vw, 26px); font-weight: 800;
          letter-spacing: -.5px; margin: 0 0 12px; color: var(--text);
          outline: 1px dashed transparent; outline-offset: 3px;
          border-radius: 3px; padding: 2px 3px;
        }
        .__site .__section h2:hover {
          outline-color: var(--p); background: var(--p-bg);
        }
        .__site .__section .__text {
          font-size: 15.5px; line-height: 1.75; color: var(--text);
          outline: 1px dashed transparent; outline-offset: 3px;
          border-radius: 3px; padding: 2px 3px;
        }
        .__site .__section .__text:hover {
          outline-color: var(--p); background: var(--p-bg);
        }
        .__site .__section .__text:focus,
        .__site .__section h2:focus {
          outline: 2px solid var(--p);
          background: var(--p-bg);
        }
        .__site .__section .__text p { margin-bottom: 1em; }
        .__site .__section .__text p:last-child { margin-bottom: 0; }
        .__site .__section .__text img {
          max-width: 100%; border-radius: 10px; margin: 8px 0; display: block;
        }
        .__site .__section .__summary {
          font-size: 13.5px; color: var(--text-soft); margin-top: 6px; font-weight: 500;
        }
        .__site .__section .__meta {
          display: flex; align-items: center; gap: 10px;
          margin-top: 16px; padding-top: 14px;
          border-top: 1px solid var(--border);
          font-size: 11.5px; color: var(--text-light); font-weight: 600;
        }
        .__site .__section .__pill {
          background: var(--bg); padding: 5px 10px; border-radius: 999px;
          border: 1px solid var(--border);
        }
        .__site .__section .__pill i { color: var(--p); font-size: 10px; margin-right: 4px; }
        .__site .__cta-inner {
          background: var(--p); color: #fff; border-radius: 16px;
          padding: 36px 28px; text-align: center;
        }
        .__site .__cta-inner h3 {
          font-size: 26px; font-weight: 800; margin-bottom: 8px; color: #fff;
        }
        .__site .__cta-inner p {
          font-size: 15px; color: rgba(255,255,255,.85); margin: 0 auto 18px; max-width: 480px;
        }
        .__site .__cta-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 12px 24px; border-radius: 999px;
          background: #fff; color: var(--p-dark);
          font-weight: 800; font-size: 13.5px;
        }
      </style>

      <div class="__topbar">
        <div class="__mark">P</div>
        <b>PDF2WEB</b>
        <span style="opacity:.6;font-size:12px;margin-left:auto" data-edit="title">${esc(title)}</span>
      </div>

      <div class="__hero" data-section-id="hero">
        <span class="__kicker"><i class="fa-solid fa-circle" style="font-size:6px"></i> Document</span>
        <h1><span data-edit="title">${esc(title)}</span></h1>
        ${subtitle ? `<p class="__subtitle" data-edit="subtitle">${esc(subtitle)}</p>` : ""}
        <p data-edit="hero">${esc(hero || "Add a short description")}</p>
        <div class="__cta-row">
          <span class="__btn-primary"><i class="fa-solid fa-book-open"></i> Start reading</span>
          <span class="__btn-secondary"><i class="fa-solid fa-envelope"></i> Get in touch</span>
        </div>
      </div>

      <div class="__body">
        ${sections.length ? sections.map((x, i) => `
          <div class="__section" data-section-id="${esc(x.id)}" data-section-index="${i}">
            <h2 data-edit="section-title" data-section="${esc(x.id)}">${esc(x.title)}</h2>
            ${x.summary ? `<p class="__summary" data-edit="section-summary" data-section="${esc(x.id)}">${esc(x.summary)}</p>` : ""}
            <div class="__text" data-edit="section-body" data-section="${esc(x.id)}">${x.text || ""}</div>
            <div class="__meta">
              <span class="__pill"><i class="fa-solid fa-book"></i> Source page ${esc(x.pages || x.page || "?")}</span>
            </div>
          </div>
        `).join("") : `<div style="padding:40px;text-align:center;color:var(--text-light)">
          No sections yet. Add one from the left rail.
        </div>`}

        <div class="__cta-inner" data-section-id="site-cta" style="margin-top:24px">
          <h3>${esc(s.ctaTitle || "Ready to learn more?")}</h3>
          <p>${esc(s.ctaText || "Explore the original document for full details.")}</p>
          <span class="__cta-btn"><i class="fa-solid fa-envelope"></i> Get in touch</span>
        </div>
      </div>
    </div>
  `;

  attachCanvasEditing();
  if (selectedSectionId) {
    canvas.querySelector(`[data-section-id="${selectedSectionId}"]`)?.classList.add("__sel");
  }
}

// Colour utilities
function lighten(hex, amount) {
  const c = hex.replace("#", "");
  const n = parseInt(c, 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + 255 * amount));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + 255 * amount));
  const b = Math.min(255, Math.round((n & 255) + 255 * amount));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
function darken(hex, amount) {
  const c = hex.replace("#", "");
  const n = parseInt(c, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amount)));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

// ============================================================
// CANVAS — inline editing
// ============================================================
function attachCanvasEditing() {
  const canvas = $("canvas");
  if (!canvas) return;

  canvas.querySelectorAll("[data-section-id]").forEach(el => {
    el.addEventListener("mousedown", e => {
      if (e.target.closest("[data-edit]")) return;
      const id = el.dataset.sectionId;
      if (id !== "hero" && id !== "site-cta") selectSection(id);
    });
  });

  canvas.querySelectorAll("[data-edit]").forEach(el => {
    el.contentEditable = "true";
    el.spellcheck = false;

    el.addEventListener("focus", () => {
      const sid = el.dataset.section || "hero";
      if (sid !== "hero" && sid !== "site-cta") selectSection(sid);
    });

    el.addEventListener("blur", () => commitEdit(el));
    el.addEventListener("input", () => markDirty());
    el.addEventListener("keydown", e => { if (e.key === "Escape") el.blur(); });

    el.addEventListener("mouseup", () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) showTextToolbar(sel);
      else hideTextToolbar();
    });
  });
}

function commitEdit(el) {
  if (!el) return;
  const kind = el.dataset.edit;
  const sectionId = el.dataset.section;

  if (kind === "title") {
    currentSite.title = el.textContent.trim() || "Untitled";
    $("editorTitle").textContent = currentSite.title;
    $("pageTitle").value = currentSite.title;
  } else if (kind === "subtitle") {
    currentSite.subtitle = el.textContent.trim();
  } else if (kind === "hero") {
    currentSite.hero = el.textContent.trim();
    $("pageHero").value = currentSite.hero;
  } else if (kind === "section-title" && sectionId) {
    const sec = currentSite.sections.find(x => x.id === sectionId);
    if (sec) sec.title = el.textContent.trim();
    renderSectionList();
    renderContextPanel();
  } else if (kind === "section-summary" && sectionId) {
    const sec = currentSite.sections.find(x => x.id === sectionId);
    if (sec) sec.summary = el.textContent.trim();
  } else if (kind === "section-body" && sectionId) {
    const sec = currentSite.sections.find(x => x.id === sectionId);
    if (sec) sec.text = el.innerHTML;
  }
  markDirty();
}

// ============================================================
// TEXT TOOLBAR
// ============================================================
function showTextToolbar(sel) {
  const bar = $("textToolbar");
  if (!bar) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  bar.style.left = Math.min(window.innerWidth - 340, Math.max(20, rect.left)) + "px";
  bar.style.top = Math.max(20, rect.top - 46) + "px";
  bar.classList.add("__show");
}
function hideTextToolbar() {
  $("textToolbar")?.classList.remove("__show");
}

function wireTextToolbar() {
  const bar = $("textToolbar");
  if (!bar) return;

  bar.querySelectorAll("button[data-cmd]").forEach(btn => {
    btn.addEventListener("mousedown", e => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "italic") document.execCommand("italic");
      else if (cmd === "underline") document.execCommand("underline");
      else if (cmd === "h2") document.execCommand("formatBlock", false, "h2");
      else if (cmd === "h3") document.execCommand("formatBlock", false, "h3");
      else if (cmd === "p") document.execCommand("formatBlock", false, "p");
      else if (cmd === "clear") document.execCommand("removeFormat");
      else if (cmd === "link") {
        pendingLinkRange = sel.getRangeAt(0).cloneRange();
        const txt = sel.toString();
        $("linkText").value = txt;
        $("linkUrl").value = "";
        openModal("linkModal");
        hideTextToolbar();
        return;
      } else if (cmd === "image") {
        hideTextToolbar();
        openImageModal();
        return;
      }

      markDirty();
      bar.querySelector("button")?.blur();
    });
  });

  document.addEventListener("mousedown", e => {
    if (!e.target.closest("#textToolbar")) hideTextToolbar();
  });
}

// ============================================================
// SECTION LIST
// ============================================================
function renderSectionList() {
  const list = $("sectionList");
  if (!list) return;
  const secs = currentSite.sections || [];
  $("secCount").textContent = secs.length;

  if (!secs.length) {
    list.innerHTML = `<div class="wf-empty" style="padding:16px 8px;font-size:12px">
      No sections yet. Add one below.
    </div>`;
    return;
  }

  list.innerHTML = secs.map((x, i) => `
    <div class="wf-sec-item ${x.id === selectedSectionId ? "__active" : ""}" data-sec="${esc(x.id)}">
      <i class="fa-solid fa-grip-vertical grip"></i>
      <span class="title">${esc(x.title || "Untitled")}</span>
      ${x.hidden ? '<i class="fa-solid fa-eye-slash" style="font-size:10px;opacity:.5"></i>' : ""}
      <span class="pg">${esc(x.page || "?")}</span>
      <button class="del" data-del-sec="${esc(x.id)}" title="Delete">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");
}

function selectSection(id) {
  selectedSectionId = id;
  const canvas = $("canvas");
  canvas?.querySelectorAll("[data-section-id]").forEach(el => {
    el.classList.toggle("__sel", el.dataset.sectionId === id);
  });
  renderSectionList();
  renderContextPanel();
  $("editorGrid")?.classList.add("__ctx-open");
}

// ============================================================
// CONTEXT PANEL
// ============================================================
function renderContextPanel() {
  const panel = $("ctxPanel");
  if (!panel) return;

  if (!selectedSectionId) {
    panel.innerHTML = `
      <div class="wf-panel-block">
        <h4><i class="fa-solid fa-info-circle"></i> Page settings</h4>
        <label class="wf-field-label">Title</label>
        <input class="field" id="ctxTitle" type="text" value="${esc(currentSite.title || "")}">

        <label class="wf-field-label">Subtitle</label>
        <input class="field" id="ctxSubtitle" type="text" value="${esc(currentSite.subtitle || "")}">

        <label class="wf-field-label">Hero</label>
        <textarea class="field" id="ctxHero" rows="3">${esc(currentSite.hero || "")}</textarea>

        <label class="wf-field-label">Slug</label>
        <input class="field" id="ctxSlug" type="text" value="${esc(currentSite.slug || "")}">

        <label class="wf-field-label">CTA heading</label>
        <input class="field" id="ctxCtaTitle" type="text" value="${esc(currentSite.ctaTitle || "")}">

        <label class="wf-field-label">CTA text</label>
        <textarea class="field" id="ctxCtaText" rows="2">${esc(currentSite.ctaText || "")}</textarea>
      </div>
      <div class="wf-panel-block">
        <h4><i class="fa-solid fa-lightbulb"></i> Tip</h4>
        <p style="margin:0;font-size:12.5px;color:var(--text-soft);line-height:1.55">
          Click any section on the canvas to edit its details. Or click directly on text to edit it in place.
        </p>
      </div>
    `;

    $("ctxTitle")?.addEventListener("input", e => {
      currentSite.title = e.target.value;
      $("editorTitle").textContent = currentSite.title;
      $("pageTitle").value = currentSite.title;
      const topTitle = $("canvas").querySelectorAll('[data-edit="title"]');
      topTitle.forEach(el => el.textContent = currentSite.title);
      markDirty();
    });
    $("ctxSubtitle")?.addEventListener("input", e => {
      currentSite.subtitle = e.target.value;
      const els = $("canvas").querySelectorAll('[data-edit="subtitle"]');
      els.forEach(el => el.textContent = currentSite.subtitle);
      markDirty();
    });
    $("ctxHero")?.addEventListener("input", e => {
      currentSite.hero = e.target.value;
      $("pageHero").value = currentSite.hero;
      const heroEl = $("canvas").querySelector('[data-edit="hero"]');
      if (heroEl) heroEl.textContent = currentSite.hero;
      markDirty();
    });
    $("ctxSlug")?.addEventListener("input", e => {
      currentSite.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      e.target.value = currentSite.slug;
      markDirty();
    });
    $("ctxCtaTitle")?.addEventListener("input", e => {
      currentSite.ctaTitle = e.target.value;
      const el = $("canvas").querySelector('[data-section-id="site-cta"] h3');
      if (el) el.textContent = currentSite.ctaTitle;
      markDirty();
    });
    $("ctxCtaText")?.addEventListener("input", e => {
      currentSite.ctaText = e.target.value;
      const el = $("canvas").querySelector('[data-section-id="site-cta"] p');
      if (el) el.textContent = currentSite.ctaText;
      markDirty();
    });
    return;
  }

  const sec = currentSite.sections.find(x => x.id === selectedSectionId);
  if (!sec) { renderContextPanel(); return; }

  panel.innerHTML = `
    <div class="wf-panel-block">
      <h4><i class="fa-solid fa-pen-to-square"></i> Section</h4>

      <label class="wf-field-label">Title</label>
      <input class="field" id="ctxSecTitle" type="text" value="${esc(sec.title || "")}">

      <label class="wf-field-label">Summary</label>
      <input class="field" id="ctxSecSummary" type="text" value="${esc(sec.summary || "")}" placeholder="One-line description">

      <label class="wf-field-label">Body</label>
      <textarea class="field" id="ctxSecBody" rows="7">${esc(stripHtml(sec.text || ""))}</textarea>

      <label class="wf-field-label">Source page</label>
      <input class="field" id="ctxSecPage" type="text" value="${esc(sec.pages || sec.page || "")}">

      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="ctxSecHidden" ${sec.hidden ? "checked" : ""}>
        Hide on the published site
      </label>
    </div>

    <div class="wf-panel-block">
      <h4><i class="fa-solid fa-image"></i> Media</h4>
      <button class="btn" id="ctxAddImg">
        <i class="fa-solid fa-image"></i> Insert image
      </button>
    </div>

    <div class="wf-panel-block">
      <h4><i class="fa-solid fa-arrows-up-down-left-right"></i> Move</h4>
      <div class="row-2">
        <button class="btn half" id="ctxMoveUp"><i class="fa-solid fa-arrow-up"></i> Up</button>
        <button class="btn half" id="ctxMoveDown"><i class="fa-solid fa-arrow-down"></i> Down</button>
      </div>
      <button class="btn" id="ctxDelete" style="margin-top:8px;color:var(--red);border-color:var(--red)">
        <i class="fa-solid fa-trash"></i> Delete section
      </button>
    </div>
  `;

  $("ctxSecTitle")?.addEventListener("input", e => {
    sec.title = e.target.value;
    const el = $("canvas").querySelector(`[data-edit="section-title"][data-section="${sec.id}"]`);
    if (el) el.textContent = sec.title;
    renderSectionList();
    markDirty();
  });
  $("ctxSecSummary")?.addEventListener("input", e => {
    sec.summary = e.target.value;
    const el = $("canvas").querySelector(`[data-edit="section-summary"][data-section="${sec.id}"]`);
    if (el) el.textContent = sec.summary;
    markDirty();
  });
  $("ctxSecBody")?.addEventListener("input", e => {
    sec.text = escapeToHtml(e.target.value);
    const el = $("canvas").querySelector(`[data-edit="section-body"][data-section="${sec.id}"]`);
    if (el) el.innerHTML = sec.text;
    markDirty();
  });
  $("ctxSecPage")?.addEventListener("input", e => { sec.pages = e.target.value; markDirty(); });
  $("ctxSecHidden")?.addEventListener("change", e => {
    sec.hidden = e.target.checked;
    renderCanvas();
    markDirty();
  });

  $("ctxAddImg")?.addEventListener("click", () => openImageModal(sec.id));
  $("ctxMoveUp")?.addEventListener("click", () => moveSection(sec.id, -1));
  $("ctxMoveDown")?.addEventListener("click", () => moveSection(sec.id, 1));
  $("ctxDelete")?.addEventListener("click", () => {
    if (!confirm(`Delete "${sec.title}"?`)) return;
    currentSite.sections = currentSite.sections.filter(x => x.id !== sec.id);
    selectedSectionId = null;
    renderCanvas();
    renderSectionList();
    renderContextPanel();
    markDirty();
  });
}

function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || "";
}
function escapeToHtml(txt) {
  return (txt || "").split(/\n\s*\n/).map(p => `<p>${esc(p.trim())}</p>`).join("");
}

function moveSection(id, dir) {
  const secs = currentSite.sections;
  const i = secs.findIndex(x => x.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= secs.length) return;
  [secs[i], secs[j]] = [secs[j], secs[i]];
  renderCanvas();
  renderSectionList();
  renderContextPanel();
  selectSection(id);
  markDirty();
}

// ============================================================
// EDITOR — WIRING
// ============================================================
function wireEditor() {
  $("editorExit")?.addEventListener("click", exitEditor);
  $("editorSaveBtn")?.addEventListener("click", saveSite);
  $("editorPreviewBtn")?.addEventListener("click", openPreview);
  $("editorPublishBtn")?.addEventListener("click", publishSite);

  $("colorPrimary")?.addEventListener("input", e => {
    currentSite.colors = currentSite.colors || {};
    currentSite.colors.primary = e.target.value;
    renderCanvas();
    markDirty();
  });
  $("colorBg")?.addEventListener("input", e => {
    currentSite.colors = currentSite.colors || {};
    currentSite.colors.bg = e.target.value;
    renderCanvas();
    markDirty();
  });
  $("colorText")?.addEventListener("input", e => {
    currentSite.colors = currentSite.colors || {};
    currentSite.colors.text = e.target.value;
    renderCanvas();
    markDirty();
  });
  $("colorsResetBtn")?.addEventListener("click", () => {
    currentSite.colors = {};
    $("colorPrimary").value = "#1e6b3a";
    $("colorBg").value = "#f4f9f6";
    $("colorText").value = "#16211c";
    renderCanvas();
    markDirty();
  });

  $("addSectionBtn")?.addEventListener("click", () => openModal("sectionModal"));
  $("fabAddSection")?.addEventListener("click", () => openModal("sectionModal"));
  $("fabAddImage")?.addEventListener("click", () => openImageModal());
  $("fabColors")?.addEventListener("click", () => {
    $("colorPrimary")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  $("sectionList")?.addEventListener("click", e => {
    const del = e.target.closest("[data-del-sec]");
    if (del) {
      if (!confirm("Delete this section?")) return;
      currentSite.sections = currentSite.sections.filter(x => x.id !== del.dataset.delSec);
      if (selectedSectionId === del.dataset.delSec) selectedSectionId = null;
      renderCanvas();
      renderSectionList();
      renderContextPanel();
      markDirty();
      return;
    }
    const item = e.target.closest("[data-sec]");
    if (item) selectSection(item.dataset.sec);
  });

  $("pageTitle")?.addEventListener("input", e => {
    currentSite.title = e.target.value;
    $("editorTitle").textContent = currentSite.title || "Untitled";
    const els = $("canvas").querySelectorAll('[data-edit="title"]');
    els.forEach(el => el.textContent = currentSite.title);
    markDirty();
  });
  $("pageHero")?.addEventListener("input", e => {
    currentSite.hero = e.target.value;
    const heroEl = $("canvas").querySelector('[data-edit="hero"]');
    if (heroEl) heroEl.textContent = currentSite.hero;
    markDirty();
  });
  $("pageSlug")?.addEventListener("input", e => {
    currentSite.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    e.target.value = currentSite.slug;
    markDirty();
  });

  wireSectionModal();
  wireImageModal();
  wireLinkModal();
  wireTextToolbar();

  window.addEventListener("beforeunload", e => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });
}

// ============================================================
// DIRTY STATE
// ============================================================
function isDirty() {
  return JSON.stringify(currentSite) !== savedSnapshot;
}
function markDirty() {
  setEditorStatus("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSite(true), 1400);
}
function setEditorStatus(kind) {
  const el = $("editorStatus");
  if (!el) return;
  el.className = "status " + kind;
  const icon = el.querySelector("i");
  const txt = el.querySelector("span");
  if (!icon || !txt) return;
  if (kind === "saving") { icon.className = "fa-solid fa-circle-notch fa-spin"; txt.textContent = "Unsaved"; }
  else if (kind === "saved") { icon.className = "fa-solid fa-circle-check"; txt.textContent = "Saved"; }
  else if (kind === "error") { icon.className = "fa-solid fa-circle-exclamation"; txt.textContent = "Error"; }
}

// ============================================================
// SAVE
// ============================================================
async function saveSite(silent) {
  if (!currentSite || !currentUser) return;
  try {
    setEditorStatus("saving");
    const updates = {
      title: currentSite.title || "",
      subtitle: currentSite.subtitle || "",
      hero: currentSite.hero || "",
      slug: currentSite.slug || "",
      colors: currentSite.colors || {},
      sections: currentSite.sections || [],
      ctaTitle: currentSite.ctaTitle || "",
      ctaText: currentSite.ctaText || "",
      updatedAt: serverTimestamp()
    };
    await updateDoc(doc(db, `users/${currentUser.uid}/websites`, currentSiteId), updates);
    Object.assign(currentSite, updates);
    savedSnapshot = JSON.stringify(currentSite);
    setEditorStatus("saved");
    if (!silent) toast("Saved", 1400, "success");
  } catch (err) {
    console.error(err);
    setEditorStatus("error");
    if (!silent) toast("Couldn't save", 2600, "error");
  }
}

// ============================================================
// PREVIEW
// ============================================================
async function openPreview() {
  await saveSite(true);
  const shell = $("previewShell");
  const frame = $("previewFrame");
  frame.srcdoc = `<div style="font-family:sans-serif;padding:40px;text-align:center;color:#4d5f57">Loading…</div>`;
  shell.classList.remove("hidden");

  try {
    const res = await call("previewWebsite")({ siteId: currentSiteId });
    frame.srcdoc = res.data.html;
  } catch (err) {
    console.error(err);
    frame.srcdoc = `<div style="font-family:sans-serif;padding:40px;color:#dc3545">Preview failed.</div>`;
  }
}

// ============================================================
// PUBLISH
// ============================================================
async function publishSite() {
  try {
    await saveSite(true);
    const res = await call("publishWebsite")({ siteId: currentSiteId, visibility: "public" });
    currentSite.status = "published";
    currentSite.slug = res.data.slug;
    currentSite.visibility = "public";
    toast(`Published · ${location.origin}/webify/${res.data.slug}`, 3200, "success");
    await loadSites();
  } catch (err) {
    console.error(err);
    toast("Couldn't publish", 2600, "error");
  }
}

// ============================================================
// EXIT
// ============================================================
function exitEditor() {
  if (isDirty()) {
    if (!confirm("You have unsaved changes. Save before leaving?")) {
      if (!confirm("Leave without saving?")) return;
    } else {
      saveSite(true);
    }
  }
  currentSiteId = null;
  currentSite = null;
  selectedSectionId = null;
  savedSnapshot = "";
  showSection("landing");
  loadSites();
  history.replaceState(null, "", "webify.html");
}

// ============================================================
// SECTION MODAL
// ============================================================
function wireSectionModal() {
  $("sectionCancelBtn")?.addEventListener("click", () => closeModal("sectionModal"));
  $$("[data-new-section]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.newSection;
      addSection(kind);
      closeModal("sectionModal");
    });
  });
}

function addSection(kind) {
  const id = "s" + Date.now();
  const newSec = {
    id,
    title: kind === "image" ? "New image section" : kind === "quote" ? "New quote" : "New section",
    type: "prose",
    summary: "",
    page: "—",
    pages: "—",
    text: kind === "quote"
      ? "<p>“A short quote.”</p>"
      : "<p>Start typing your content here.</p>",
    hidden: false
  };
  currentSite.sections = currentSite.sections || [];
  currentSite.sections.push(newSec);
  selectedSectionId = id;
  renderCanvas();
  renderSectionList();
  renderContextPanel();
  markDirty();

  setTimeout(() => {
    $("canvas").querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

// ============================================================
// IMAGE MODAL
// ============================================================
function openImageModal(targetSectionId) {
  pendingImageInsert = { sectionId: targetSectionId || selectedSectionId || (currentSite.sections[0]?.id) };
  $("imgFileInput").value = "";
  $("imgPreviewWrap").style.display = "none";
  $("imgAlt").value = "";
  $("imgInsertBtn").disabled = true;
  openModal("imgModal");
}

function wireImageModal() {
  $("imgCancelBtn")?.addEventListener("click", () => closeModal("imgModal"));
  $("imgDropZone")?.addEventListener("click", () => $("imgFileInput")?.click());

  $("imgFileInput")?.addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    $("imgPreview").src = url;
    $("imgPreviewWrap").style.display = "block";
    $("imgInsertBtn").disabled = false;
    $("imgInsertBtn").dataset.fileReady = "1";
  });

  $("imgInsertBtn")?.addEventListener("click", async () => {
    const file = $("imgFileInput").files?.[0];
    if (!file) return;
    try {
      $("imgInsertBtn").disabled = true;
      $("imgInsertBtn").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading…`;

      const path = `users/${currentUser.uid}/websites/${currentSiteId}/assets/${Date.now()}-${file.name}`;
      const sref = sRef(storage, path);
      await uploadBytesResumable(sref, file);
      const url = await getDownloadURL(sref);

      const alt = $("imgAlt").value || file.name;
      const html = `<img src="${url}" alt="${esc(alt)}">`;

      const sid = pendingImageInsert?.sectionId;
      if (sid) {
        const sec = currentSite.sections.find(x => x.id === sid);
        if (sec) sec.text = (sec.text || "") + "\n" + html;
      }
      renderCanvas();
      markDirty();
      closeModal("imgModal");
      toast("Image added", 1600, "success");
    } catch (err) {
      console.error(err);
      toast("Couldn't upload image", 2600, "error");
    } finally {
      $("imgInsertBtn").disabled = false;
      $("imgInsertBtn").innerHTML = `<i class="fa-solid fa-check"></i> Insert image`;
    }
  });
}

// ============================================================
// LINK MODAL
// ============================================================
function wireLinkModal() {
  $("linkCancelBtn")?.addEventListener("click", () => closeModal("linkModal"));
  $("linkInsertBtn")?.addEventListener("click", () => {
    const url = $("linkUrl").value.trim();
    const txt = $("linkText").value.trim();
    if (!url) { toast("Enter a URL", 1800, "error"); return; }
    if (pendingLinkRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(pendingLinkRange);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = txt || url;
      pendingLinkRange.deleteContents();
      pendingLinkRange.insertNode(a);
    }
    pendingLinkRange = null;
    closeModal("linkModal");
    markDirty();
  });
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { $(id)?.classList.add("__show"); }
function closeModal(id) { $(id)?.classList.remove("__show"); }

// Close modals on backdrop click
["imgModal", "linkModal", "sectionModal"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("click", e => {
    if (e.target === el) closeModal(id);
  });
});

// Preview close
$("previewCloseBtn")?.addEventListener("click", () => $("previewShell")?.classList.add("hidden"));
$("previewPublishBtn")?.addEventListener("click", () => { $("previewShell")?.classList.add("hidden"); publishSite(); });

// ============================================================
// INITIAL
// ============================================================
showSection("landing");