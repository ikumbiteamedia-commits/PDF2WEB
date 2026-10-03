// js/tools-merge.js
// Merge PDFs with a proper file + page picker. 100% client-side (PDF.js thumbnails, pdf-lib merge).
// Decisions: reordering is file-level (drag in the order list, or the up/down arrows); pages inside a file keep
// their original order. Thumbnails render lazily (IntersectionObserver) through a small queue so big PDFs stay smooth.

import { $id, esc, formatBytes, toast } from "./tools/index.js";
import { injectStyles } from "./util.js";

const { PDFDocument } = PDFLib;

const CSS = `
.mg-wrap{display:flex;flex-direction:column;gap:16px;width:100%}
.mg-count{font-weight:800;color:var(--primary-dark);font-size:14px;background:var(--primary-bg);padding:10px 14px;border-radius:12px}
.mg-master{display:flex;align-items:center;gap:10px;font-weight:700;font-size:13.5px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.mg-master input,.mg-file-head input[type=checkbox]{width:17px;height:17px;accent-color:var(--primary)}
.mg-order{list-style:none;display:flex;flex-direction:column;gap:6px;padding:0;margin:0}
.mg-order li{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);font-size:12.5px}
.mg-order li.dragging{opacity:.4}
.mg-order li.off{opacity:.5}
.mg-order .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.mg-order .grip{cursor:grab;color:var(--text-light)}
.mg-order button{border:0;background:none;cursor:pointer;color:var(--text-soft);padding:4px 6px;border-radius:6px}
.mg-order button:hover{background:var(--primary-bg);color:var(--primary-dark)}
.mg-order button:disabled{opacity:.25;cursor:default}
.mg-prev{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mg-prev figure{margin:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff;position:relative}
.mg-prev canvas{display:block;width:100%;height:auto}
.mg-prev figcaption{position:absolute;left:4px;bottom:4px;font-size:10px;font-weight:800;background:var(--primary);color:#fff;border-radius:6px;padding:1px 6px}
.mg-sec{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px}
.mg-sec.off{opacity:.55}
.mg-file-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.mg-file-head .fn{font-weight:800;min-width:0;flex:1 1 180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-file-head .meta{font-size:12px;color:var(--text-soft);white-space:nowrap}
.mg-file-head .acts{display:flex;gap:6px;flex-wrap:wrap}
.mg-file-head .acts .btn{padding:6px 10px;font-size:12px}
.mg-x{border:0;background:none;color:var(--danger);cursor:pointer;font-size:15px;padding:6px}
.mg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
.mg-pg{position:relative;border:3px solid var(--border);border-radius:10px;background:#fff;padding:0;cursor:pointer;overflow:hidden;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font:inherit}
.mg-pg canvas{display:block;max-width:100%;max-height:100%}
.mg-pg .n{position:absolute;left:4px;bottom:4px;font-size:10.5px;font-weight:800;background:rgba(15,26,20,.78);color:#fff;border-radius:6px;padding:1px 6px}
.mg-pg .ck{position:absolute;right:5px;top:5px;width:22px;height:22px;border-radius:50%;background:var(--primary);color:#fff;display:none;align-items:center;justify-content:center;font-size:11px}
.mg-pg.on{border-color:var(--primary)}
.mg-pg.on .ck{display:flex}
.mg-pg:not(.on){filter:grayscale(1);opacity:.5}
.mg-pg:focus-visible{outline:3px solid var(--primary-light);outline-offset:2px}
.mg-pg .ph{color:var(--text-light);font-size:18px}
.mg-hint{font-size:12px;color:var(--text-soft)}
.mg-dl{display:flex;flex-direction:column;gap:8px;padding:14px;border:1px solid var(--primary);border-radius:12px;background:var(--primary-bg)}
.mg-name{width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;font:inherit}
`;

// ============================================================
// STATE
// ============================================================
let files = [];            // { id, name, size, bytes:ArrayBuffer, pdf:PDFDocumentProxy, n, sel:Set<number>, include:boolean }
let uid = 0;
let dragIdx = null;
let result = null;         // { url, size, pages }
let prevToken = 0;
const thumbCache = new Map();   // "fileId:page:w" -> canvas
let root = null;

// ---------- render queue (2 at a time) ----------
const queue = []; let running = 0;
function enqueue(job) { queue.push(job); pump(); }
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift(); running++;
    job().catch(() => {}).finally(() => { running--; pump(); });
  }
}

async function renderPage(f, pageNo, width) {
  const key = `${f.id}:${pageNo}:${width}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const page = await f.pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  thumbCache.set(key, c);
  return c;
}

// ============================================================
// MOUNT
// ============================================================
function mount(el, onExit) {
  root = el;
  files = []; result = null; thumbCache.clear(); prevToken++;
  injectStyles("pdf2web-merge-css", CSS);

  el.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1e6b3a"><i class="fa-solid fa-object-group"></i></div>
        <div><h2>Merge PDFs</h2><small>Pick the files, choose the pages, set the order, merge.</small></div>
      </div>
    </div>

    <div class="ws-body">
      <aside class="ws-controls">
        <div class="ws-upload" id="wsUpload">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <b>Drop PDFs here</b>
          <span>or click to choose several at once</span>
          <button class="btn primary" id="wsChoose" type="button"><i class="fa-solid fa-folder-open"></i> Choose Files</button>
          <input type="file" id="wsInput" accept="application/pdf" multiple hidden>
        </div>
        <div id="wsError" class="err"></div>

        <div id="mgSide" class="mg-wrap hidden">
          <div class="mg-count" id="mgCount"></div>
          <label class="mg-master"><input type="checkbox" id="mgMaster"> Include all files</label>
          <div>
            <b style="font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">File order (top = first)</b>
            <ul class="mg-order" id="mgOrder"></ul>
            <p class="mg-hint" style="margin-top:6px"><i class="fa-solid fa-grip-vertical"></i> Drag, or use the arrows, to reorder files.</p>
          </div>
          <div>
            <b style="font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-soft)">First selected pages</b>
            <div class="mg-prev" id="mgPrev" style="margin-top:8px"></div>
          </div>
          <div>
            <label for="mgName" class="mg-hint" style="font-weight:700">Output file name</label>
            <input class="mg-name" id="mgName" value="merged.pdf">
          </div>
          <div id="mgResult"></div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview" style="align-items:stretch">
        <div class="ws-empty" id="mgEmpty">
          <i class="fa-solid fa-file-pdf"></i><b>No files yet</b>
          <span>Add PDFs to see every page here and choose which ones to merge.</span>
        </div>
        <div id="mgSections" class="mg-wrap"></div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left"><button class="btn" id="wsCancel" type="button"><i class="fa-solid fa-xmark"></i> Cancel</button></div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" type="button" disabled><i class="fa-solid fa-object-group"></i> Merge pages</button>
      </div>
    </div>`;

  $id("wsBack").onclick = onExit;
  $id("wsCancel").onclick = onExit;

  const input = $id("wsInput"), zone = $id("wsUpload");
  $id("wsChoose").onclick = (e) => { e.stopPropagation(); input.click(); };
  input.addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", (e) => {
    const list = [...e.dataTransfer.files].filter(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (list.length) addFiles(list); else toast("Please drop PDF files only.");
  });

  $id("mgMaster").addEventListener("change", (e) => {
    files.forEach(f => (f.include = e.target.checked));
    invalidate(); refreshAll();
  });
  $id("wsProcess").onclick = doMerge;
}

// ============================================================
// ADD FILES
// ============================================================
async function addFiles(list) {
  if (!list.length) return;
  $id("wsError").textContent = "";
  for (const file of list) {
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;   // copy: worker detaches the buffer
      const f = { id: ++uid, name: file.name, size: file.size, bytes, pdf, n: pdf.numPages, sel: new Set(), include: true };
      for (let i = 1; i <= f.n; i++) f.sel.add(i);
      files.push(f);
    } catch (e) {
      console.error(e);
      toast(`Couldn't read "${file.name}" (password-protected or corrupt).`);
    }
  }
  invalidate(); renderSections(); refreshAll();
}

function invalidate() {
  if (result) { URL.revokeObjectURL(result.url); result = null; }
  const box = $id("mgResult"); if (box) box.innerHTML = "";
}

// ============================================================
// SECTIONS (one per file, page grid inside)
// ============================================================
function renderSections() {
  const host = $id("mgSections");
  $id("mgEmpty").classList.toggle("hidden", files.length > 0);
  $id("mgSide").classList.toggle("hidden", files.length === 0);

  host.innerHTML = files.map(f => `
    <section class="mg-sec ${f.include ? "" : "off"}" data-fid="${f.id}">
      <div class="mg-file-head">
        <input type="checkbox" data-inc="${f.id}" ${f.include ? "checked" : ""} title="Include this file">
        <i class="fa-solid fa-file-pdf" style="color:var(--primary)"></i>
        <span class="fn" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="meta" data-meta="${f.id}"></span>
        <span class="acts">
          <button class="btn" data-all="${f.id}" type="button">Select all</button>
          <button class="btn" data-none="${f.id}" type="button">Deselect all</button>
          <button class="btn" data-inv="${f.id}" type="button">Invert</button>
        </span>
        <button class="mg-x" data-rm="${f.id}" title="Remove file" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="mg-grid" data-grid="${f.id}">
        ${Array.from({ length: f.n }, (_, i) => `
          <button type="button" class="mg-pg ${f.sel.has(i + 1) ? "on" : ""}" data-fid="${f.id}" data-pg="${i + 1}" aria-pressed="${f.sel.has(i + 1)}" title="Page ${i + 1}">
            <i class="fa-regular fa-file ph"></i><span class="n">${i + 1}</span><span class="ck"><i class="fa-solid fa-check"></i></span>
          </button>`).join("")}
      </div>
    </section>`).join("");

  // lazy thumbnails
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const btn = en.target, f = files.find(x => x.id === +btn.dataset.fid);
      if (!f) return;
      enqueue(async () => {
        const c = await renderPage(f, +btn.dataset.pg, 150);
        if (!btn.isConnected) return;
        const copy = document.createElement("canvas");
        copy.width = c.width; copy.height = c.height; copy.getContext("2d").drawImage(c, 0, 0);
        btn.querySelector(".ph")?.remove();
        btn.prepend(copy);
      });
    });
  }, { rootMargin: "300px" });
  host.querySelectorAll(".mg-pg").forEach(b => io.observe(b));
}

// click handling (delegated)
document.addEventListener("click", (e) => {
  if (!root || !root.isConnected) return;
  const pg = e.target.closest(".mg-pg");
  if (pg && root.contains(pg)) {
    const f = files.find(x => x.id === +pg.dataset.fid), n = +pg.dataset.pg;
    if (!f) return;
    f.sel.has(n) ? f.sel.delete(n) : f.sel.add(n);
    pg.classList.toggle("on", f.sel.has(n)); pg.setAttribute("aria-pressed", f.sel.has(n));
    invalidate(); refreshAll(false); return;
  }
  const act = (attr) => { const el = e.target.closest(`[${attr}]`); return el && root.contains(el) ? files.find(x => x.id === +el.getAttribute(attr)) : null; };
  let f;
  if ((f = act("data-all")))  { for (let i = 1; i <= f.n; i++) f.sel.add(i); syncGrid(f); }
  else if ((f = act("data-none"))) { f.sel.clear(); syncGrid(f); }
  else if ((f = act("data-inv")))  { for (let i = 1; i <= f.n; i++) f.sel.has(i) ? f.sel.delete(i) : f.sel.add(i); syncGrid(f); }
  else if ((f = act("data-rm")))   { files = files.filter(x => x !== f); thumbCache.forEach((_, k) => k.startsWith(f.id + ":") && thumbCache.delete(k)); f.pdf.destroy?.(); invalidate(); renderSections(); refreshAll(); return; }
  else return;
  invalidate(); refreshAll(false);
});

document.addEventListener("change", (e) => {
  if (!root || !root.isConnected) return;
  const cb = e.target.closest("[data-inc]");
  if (!cb || !root.contains(cb)) return;
  const f = files.find(x => x.id === +cb.dataset.inc);
  if (f) { f.include = cb.checked; invalidate(); refreshAll(); }
});

function syncGrid(f) {
  root.querySelectorAll(`.mg-pg[data-fid="${f.id}"]`).forEach(b => {
    const on = f.sel.has(+b.dataset.pg);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  });
}

// ============================================================
// SIDE PANEL: counts, master, order list, preview
// ============================================================
function counts() {
  const inc = files.filter(f => f.include);
  const total = inc.reduce((s, f) => s + f.n, 0);
  const sel = inc.reduce((s, f) => s + f.sel.size, 0);
  const usedFiles = inc.filter(f => f.sel.size > 0).length;
  return { total, sel, usedFiles, incFiles: inc.length };
}

function refreshAll(rebuildOrder = true) {
  if (!root) return;
  const c = counts();
  $id("mgCount").textContent = files.length
    ? `Selected ${c.sel} of ${c.total} pages across ${c.usedFiles} file${c.usedFiles === 1 ? "" : "s"}.`
    : "";

  const master = $id("mgMaster");
  if (master) {
    master.checked = files.length > 0 && c.incFiles === files.length;
    master.indeterminate = c.incFiles > 0 && c.incFiles < files.length;
  }

  files.forEach(f => {
    const m = root.querySelector(`[data-meta="${f.id}"]`);
    if (m) m.textContent = `${f.n} page${f.n === 1 ? "" : "s"} · ${formatBytes(f.size)} · ${f.sel.size} selected`;
    const sec = root.querySelector(`.mg-sec[data-fid="${f.id}"]`);
    if (sec) sec.classList.toggle("off", !f.include);
    const cb = root.querySelector(`[data-inc="${f.id}"]`);
    if (cb) cb.checked = f.include;
  });

  if (rebuildOrder) renderOrder();
  const btn = $id("wsProcess");
  if (btn) {
    btn.disabled = c.sel === 0;
    btn.innerHTML = `<i class="fa-solid fa-object-group"></i> Merge ${c.sel} page${c.sel === 1 ? "" : "s"}`;
  }
  $id("wsError").textContent = files.length && c.sel === 0 ? "Select at least one page to merge." : "";
  renderPreview();
}

function renderOrder() {
  const ul = $id("mgOrder"); if (!ul) return;
  ul.innerHTML = files.map((f, i) => `
    <li draggable="true" data-i="${i}" class="${f.include ? "" : "off"}">
      <span class="grip"><i class="fa-solid fa-grip-vertical"></i></span>
      <span class="nm" title="${esc(f.name)}">${i + 1}. ${esc(f.name)}</span>
      <span class="mg-hint">${f.sel.size}/${f.n}</span>
      <button type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} title="Move up"><i class="fa-solid fa-chevron-up"></i></button>
      <button type="button" data-down="${i}" ${i === files.length - 1 ? "disabled" : ""} title="Move down"><i class="fa-solid fa-chevron-down"></i></button>
    </li>`).join("");

  ul.ondragstart = (e) => { const li = e.target.closest("li"); if (!li) return; dragIdx = +li.dataset.i; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
  ul.ondragend = () => { dragIdx = null; ul.querySelectorAll("li").forEach(l => l.classList.remove("dragging")); };
  ul.ondragover = (e) => {
    e.preventDefault();
    const li = e.target.closest("li"); if (!li || dragIdx === null) return;
    const over = +li.dataset.i; if (over === dragIdx) return;
    moveFile(dragIdx, over); dragIdx = over;
  };
  ul.onclick = (e) => {
    const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-down]");
    if (up) moveFile(+up.dataset.up, +up.dataset.up - 1);
    if (dn) moveFile(+dn.dataset.down, +dn.dataset.down + 1);
  };
}

function moveFile(from, to) {
  if (to < 0 || to >= files.length) return;
  const [m] = files.splice(from, 1); files.splice(to, 0, m);
  // reorder the sections in the DOM (no re-render, keeps thumbnails)
  const host = $id("mgSections");
  files.forEach(f => { const s = host.querySelector(`.mg-sec[data-fid="${f.id}"]`); if (s) host.appendChild(s); });
  invalidate(); renderOrder(); renderPreview();
}

// first 3 selected pages (in output order) as larger thumbnails
async function renderPreview() {
  const box = $id("mgPrev"); if (!box) return;
  const token = ++prevToken;
  const picks = [];
  for (const f of files) {
    if (!f.include) continue;
    for (const p of [...f.sel].sort((a, b) => a - b)) { picks.push({ f, p }); if (picks.length === 3) break; }
    if (picks.length === 3) break;
  }
  if (!picks.length) { box.innerHTML = `<p class="mg-hint" style="grid-column:1/-1">Nothing selected yet.</p>`; return; }
  box.innerHTML = picks.map(() => `<figure style="aspect-ratio:3/4"></figure>`).join("");
  const figs = [...box.children];
  for (let i = 0; i < picks.length; i++) {
    const { f, p } = picks[i];
    try {
      const c = await renderPage(f, p, 260);
      if (token !== prevToken) return;
      const copy = document.createElement("canvas");
      copy.width = c.width; copy.height = c.height; copy.getContext("2d").drawImage(c, 0, 0);
      figs[i].style.aspectRatio = ""; figs[i].append(copy);
      figs[i].insertAdjacentHTML("beforeend", `<figcaption>${i + 1}</figcaption>`);
    } catch {}
  }
}

// ============================================================
// MERGE (pdf-lib, client-side)
// ============================================================
async function doMerge() {
  const c = counts();
  if (!c.sel) return;
  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Merging…`;
  invalidate();

  try {
    const out = await PDFDocument.create();
    const list = files.filter(f => f.include && f.sel.size);
    let done = 0;
    for (const f of list) {
      const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
      const idx = [...f.sel].sort((a, b) => a - b).map(n => n - 1);
      const pages = await out.copyPages(src, idx);
      pages.forEach(p => out.addPage(p));
      done++;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Merging ${done}/${list.length}…`;
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    result = { url, size: blob.size, pages: c.sel };

    let name = ($id("mgName").value || "merged").trim().replace(/[\\/:*?"<>|]+/g, "-");
    if (!/\.pdf$/i.test(name)) name += ".pdf";
    $id("mgResult").innerHTML = `
      <div class="mg-dl">
        <b><i class="fa-solid fa-circle-check" style="color:var(--primary)"></i> ${esc(name)}</b>
        <span class="mg-hint">${result.pages} pages · ${formatBytes(blob.size)}</span>
        <a class="btn primary" href="${url}" download="${esc(name)}" style="justify-content:center"><i class="fa-solid fa-download"></i> Download</a>
      </div>`;
    toast("Merged! Click Download to save.");
  } catch (err) {
    console.error(err);
    toast("Merge failed: " + (err.message || "check the files and try again"));
  }
  refreshAll(false);
}

export const mergeTool = {
  id: "merge",
  name: "Merge PDFs",
  desc: "Combine PDFs — pick files, choose pages, set the order.",
  icon: "fa-object-group",
  color: "#1e6b3a",
  mount
};
