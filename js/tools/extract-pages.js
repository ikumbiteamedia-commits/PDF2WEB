// js/tools/extract-pages.js
// Extract Pages — keep only the pages you select, drop the rest.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument } = PDFLib;

let pickedFile = null;
let previewPdf = null;
let pageCount = 0;
let selectedToKeep = new Set();

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  pageCount = 0;
  selectedToKeep = new Set();

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1e6b3a"><i class="fa-solid fa-file-export"></i></div>
        <div>
          <h2>Extract Pages</h2>
          <small>Click pages in the grid to keep them. Everything else is discarded.</small>
        </div>
      </div>
    </div>

    <div class="ws-body">
      <aside class="ws-controls">
        <div class="ws-upload" id="wsUpload">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <b>Drop a PDF here</b>
          <span>or click to choose from your device</span>
          <button class="btn primary" id="wsChoose">
            <i class="fa-solid fa-folder-open"></i> Choose File
          </button>
          <input type="file" id="wsInput" accept="application/pdf" hidden>
        </div>

        <div id="wsError" class="err"></div>

        <div id="wsOptionsBlock" class="hidden" style="display:flex;flex-direction:column;gap:14px">
          <div class="ws-field">
            <label>Summary</label>
            <div class="summary-box">
              <div class="summary-row"><span>Total pages</span><b id="epTotal">—</b></div>
              <div class="summary-row"><span>Selected to keep</span><b id="epKeep" style="color:var(--primary)">0</b></div>
              <div class="summary-row"><span>Will be discarded</span><b id="epDiscard" style="color:var(--danger)">—</b></div>
            </div>
          </div>

          <div class="ws-field">
            <label>Or type pages to keep</label>
            <input type="text" id="epManual" placeholder="e.g. 1-5, 10, 12-15">
            <button class="btn" id="epApplyManual" style="margin-top:6px;width:100%;justify-content:center">
              <i class="fa-solid fa-check"></i> Apply page list
            </button>
          </div>

          <button class="btn" id="epClear" style="width:100%;justify-content:center">
            <i class="fa-solid fa-rotate-left"></i> Clear selection
          </button>

          <button class="btn" id="epAll" style="width:100%;justify-content:center">
            <i class="fa-solid fa-check-double"></i> Select all
          </button>

          <div class="info-card">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>Non-destructive</b>
              <span>Original file unchanged. Result is a new PDF containing only the pages you kept.</span>
            </div>
          </div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to see the page grid.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-file-export"></i> Extract Pages
        </button>
      </div>
    </div>
  `;

  $id("wsBack").onclick = onExit;
  $id("wsCancel").onclick = onExit;

  const input = $id("wsInput");
  const dropzone = $id("wsUpload");
  $id("wsChoose").onclick = () => input.click();
  input.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) pickFile(f);
    e.target.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && /pdf$/i.test(f.type || f.name)) pickFile(f);
    else toast("Please drop a PDF file.");
  });

  $id("epApplyManual").onclick = () => {
    const text = $id("epManual").value.trim();
    if (!text) return;
    selectedToKeep = new Set(parsePageList(text, pageCount));
    updateGrid();
    updateSummary();
    persistState();
  };
  $id("epClear").onclick = () => {
    selectedToKeep.clear();
    updateGrid();
    updateSummary();
    persistState();
  };
  $id("epAll").onclick = () => {
    selectedToKeep = new Set();
    for (let i = 1; i <= pageCount; i++) selectedToKeep.add(i);
    updateGrid();
    updateSummary();
    persistState();
  };

  $id("wsProcess").onclick = process;

  try {
    const saved = await loadState("extract-pages");
    if (saved) {
      if (saved.opts.selectedToKeep) selectedToKeep = new Set(saved.opts.selectedToKeep);
      if (saved.files && saved.files.length) {
        await pickFile(saved.files[0]);
        toast("Restored your previous session");
      }
    }
  } catch (e) { console.warn(e); }
}

// ============================================================
// PERSIST
// ============================================================
function persistState() {
  saveState("extract-pages", { selectedToKeep: [...selectedToKeep] }, pickedFile ? [pickedFile] : []);
}

// ============================================================
// HELPERS
// ============================================================
function parsePageList(text, total) {
  const out = [];
  for (const part of String(text).split(",")) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, +m[1]);
      const b = Math.min(total, +m[2]);
      if (a <= b) for (let i = a; i <= b; i++) out.push(i);
    } else {
      const n = +s;
      if (n >= 1 && n <= total) out.push(n);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// ============================================================
// PICK + RENDER
// ============================================================
async function pickFile(file) {
  const err = $id("wsError");
  err.textContent = "";
  if (!/pdf$/i.test(file.type || file.name)) {
    err.textContent = "Only PDF files are supported.";
    return;
  }
  try {
    const bytes = await file.arrayBuffer();
    previewPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pageCount = previewPdf.getPageCount();
    pickedFile = file;
    $id("epTotal").textContent = pageCount;
    $id("wsOptionsBlock").classList.remove("hidden");
    await renderThumbnails();
    updateSummary();
    persistState();
  } catch (e) {
    console.error(e);
    err.textContent = "Couldn't open this PDF. It may be password-protected.";
  }
}

async function renderThumbnails() {
  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="thumbProgress" style="width:0%"></i></div>
      <p class="ws-progress-label" id="thumbLabel">Loading pages…</p>
    </div>
    <div class="thumb-grid" id="thumbGrid"></div>
  `;
  const grid = $id("thumbGrid");
  const bytes = await pickedFile.arrayBuffer();
  const pdfjs = await pdfjsLib.getDocument({ data: bytes }).promise;

  for (let i = 1; i <= pageCount; i++) {
    const card = document.createElement("div");
    card.className = "thumb-card";
    card.dataset.page = i;
    if (selectedToKeep.has(i)) card.classList.add("marked");
    card.innerHTML = `
      <div class="thumb-canvas-wrap"><div class="thumb-loading"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
      <div class="thumb-number">${i}</div>
    `;
    card.addEventListener("click", () => {
      if (selectedToKeep.has(i)) selectedToKeep.delete(i);
      else selectedToKeep.add(i);
      card.classList.toggle("marked");
      updateSummary();
      persistState();
    });
    grid.appendChild(card);
  }

  const CONC = 4;
  let next = 1;
  let done = 0;
  async function worker() {
    while (true) {
      const p = next++;
      if (p > pageCount) return;
      try {
        const page = await pdfjs.getPage(p);
        const vp = page.getViewport({ scale: 0.5 });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        const dataUrl = c.toDataURL("image/jpeg", 0.7);
        const card = grid.querySelector(`[data-page="${p}"]`);
        const wrap = card.querySelector(".thumb-canvas-wrap");
        wrap.innerHTML = "";
        const img = document.createElement("img");
        img.src = dataUrl;
        wrap.appendChild(img);
      } catch (e) { console.warn("Thumb failed", p, e); }
      done++;
      $id("thumbProgress").style.width = (done / pageCount) * 100 + "%";
      $id("thumbLabel").textContent = `Loading pages… ${done}/${pageCount}`;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  $id("thumbProgress")?.parentElement?.parentElement?.style.display === "none" || (document.querySelector(".ws-progress")?.remove());
}

function updateGrid() {
  document.querySelectorAll(".thumb-card").forEach((card) => {
    const p = +card.dataset.page;
    card.classList.toggle("marked", selectedToKeep.has(p));
  });
}

function updateSummary() {
  $id("epKeep").textContent = selectedToKeep.size;
  $id("epDiscard").textContent = pageCount - selectedToKeep.size;

  const process = $id("wsProcess");
  if (!pickedFile) { process.disabled = true; return; }
  if (selectedToKeep.size === 0) {
    process.disabled = true;
    process.innerHTML = `<i class="fa-solid fa-file-export"></i> Select pages to keep`;
    return;
  }
  process.disabled = false;
  process.innerHTML = `<i class="fa-solid fa-file-export"></i> Extract ${selectedToKeep.size} page${selectedToKeep.size > 1 ? "s" : ""}`;
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return toast("Add a PDF first.");
  if (!selectedToKeep.size) return toast("Select at least one page to keep.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Extracting…`;

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const bytes = await pickedFile.arrayBuffer();
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const keep = [...selectedToKeep].sort((a, b) => a - b).map((n) => n - 1);

    $id("wsProgressFill").style.width = "50%";
    $id("wsProgressLabel").textContent = `Building new PDF with ${keep.length} pages…`;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, keep);
    copied.forEach((p) => out.addPage(p));

    $id("wsProgressFill").style.width = "90%";
    $id("wsProgressLabel").textContent = "Saving…";

    const outBytes = await out.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "extracted.pdf";

    const right = $id("wsActionsRight");
    right.innerHTML = `
      <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
      <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
        <i class="fa-solid fa-download"></i> Download
      </a>
    `;
    $id("wsRename").onclick = () => {
      const box = document.createElement("div");
      box.className = "rename-box";
      box.innerHTML = `
        <div class="box">
          <h3>Rename file</h3>
          <input type="text" id="renameInput" value="extracted">
          <div class="actions">
            <button class="btn" id="renameCancel">Cancel</button>
            <button class="btn primary" id="renameSave">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(box);
      const input = box.querySelector("#renameInput");
      input.focus(); input.select();
      const close = () => box.remove();
      box.querySelector("#renameCancel").onclick = close;
      box.querySelector("#renameSave").onclick = () => {
        let v = input.value.trim() || "extracted";
        if (!/\.pdf$/i.test(v)) v += ".pdf";
        $id("wsDownload").setAttribute("download", v);
        const nameEl = $id("wsResultName");
        if (nameEl) nameEl.textContent = v;
        toast(`Renamed to ${v}`);
        close();
      };
    };
    $id("wsDownload").addEventListener("click", () => clearState("extract-pages"));

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    const pdfjs = await pdfjsLib.getDocument({ data: outBytes }).promise;
    const pg = await pdfjs.getPage(1);
    const vp = pg.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${keep.length} pages · ${formatBytes(blob.size)}</span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast("Extracted! Click Download.");
  } catch (e) {
    console.error(e);
    toast("Extract failed. Try again.");
    btn.disabled = false;
    updateSummary();
  }
}

export const extractPagesTool = {
  id: "extract-pages",
  name: "Extract Pages",
  desc: "Keep only the pages you select. Discard the rest.",
  icon: "fa-file-export",
  color: "#1e6b3a",
  mount
};