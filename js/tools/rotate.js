// js/tools/rotate.js
// Rotate PDF — rotate pages by 90/180/270 degrees with live preview.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument, degrees } = PDFLib;

let pickedFile = null;
let previewPdf = null;
let previewPageIndex = 0;
let pageCount = 0;
let currentRotation = 0;   // 0, 90, 180, 270

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  previewPageIndex = 0;
  pageCount = 0;
  currentRotation = 0;

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1e6b3a"><i class="fa-solid fa-rotate-right"></i></div>
        <div>
          <h2>Rotate PDF</h2>
          <small>Rotate all pages. Preview updates live.</small>
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
            <label>Rotate all pages</label>
            <div class="rotate-buttons">
              <button class="btn" data-rot="90">
                <i class="fa-solid fa-rotate-right"></i> 90° CW
              </button>
              <button class="btn" data-rot="180">
                <i class="fa-solid fa-rotate" style="transform:rotate(90deg)"></i> 180°
              </button>
              <button class="btn" data-rot="270">
                <i class="fa-solid fa-rotate-left"></i> 90° CCW
              </button>
            </div>
          </div>

          <div class="ws-field">
            <label>Preview page</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn" id="rtPrevPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-left"></i></button>
              <span style="flex:1;text-align:center;font-weight:700;color:var(--text-soft)">
                <span id="rtPageNum">1</span> / <span id="rtPageTotal">—</span>
              </span>
              <button class="btn" id="rtNextPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>

          <div class="info-card">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>Applied to every page</b>
              <span>Rotation is applied to all pages in the document, not just the preview page.</span>
            </div>
          </div>

        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF and choose a rotation.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-rotate-right"></i> Rotate PDF
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

  document.querySelectorAll("[data-rot]").forEach((b) => {
    b.onclick = () => {
      currentRotation = (currentRotation + parseInt(b.dataset.rot)) % 360;
      updateRotationButtons();
      renderPreview();
      persistState();
    };
  });

  $id("rtPrevPage").onclick = () => {
    if (previewPageIndex > 0) { previewPageIndex--; renderPreview(); persistState(); }
  };
  $id("rtNextPage").onclick = () => {
    if (previewPageIndex < pageCount - 1) { previewPageIndex++; renderPreview(); persistState(); }
  };

  $id("wsProcess").onclick = process;

  try {
    const saved = await loadState("rotate");
    if (saved) {
      if (saved.opts.currentRotation) currentRotation = saved.opts.currentRotation;
      if (saved.opts.previewPageIndex) previewPageIndex = saved.opts.previewPageIndex;
      updateRotationButtons();
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
  saveState("rotate", { currentRotation, previewPageIndex }, pickedFile ? [pickedFile] : []);
}

// ============================================================
// UPDATE ROTATION BUTTONS
// ============================================================
function updateRotationButtons() {
  const display = $("rtRotationDisplay");
  // Nothing else to sync; currentRotation drives the preview
}

function $(id) { return document.getElementById(id); }

// ============================================================
// PICK FILE
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

    $id("rtPageTotal").textContent = pageCount;
    $id("rtPageNum").textContent = previewPageIndex + 1;
    $id("wsOptionsBlock").classList.remove("hidden");
    $id("wsProcess").disabled = false;

    renderPreview();
    persistState();
  } catch (e) {
    console.error(e);
    err.textContent = "Couldn't open this PDF. It may be password-protected.";
  }
}

// ============================================================
// PREVIEW
// ============================================================
async function renderPreview() {
  if (!previewPdf) return;

  const preview = $id("wsPreview");
  preview.innerHTML = `<div class="ws-progress"><div class="ws-progress-bar"><i style="width:0%"></i></div><p class="ws-progress-label">Rendering…</p></div>`;

  try {
    const bytes = await previewPdf.save();
    const pdfjs = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdfjs.getPage(previewPageIndex + 1);
    // Rotation applies on top of the page's existing rotation
    const vp = page.getViewport({ scale: 1, rotation: (page.rotate + currentRotation) % 360 });
    const targetWidth = Math.min(680, preview.clientWidth - 40);
    const scale = targetWidth / vp.width;
    const finalVp = page.getViewport({ scale, rotation: (page.rotate + currentRotation) % 360 });

    const canvas = document.createElement("canvas");
    canvas.width = finalVp.width;
    canvas.height = finalVp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: finalVp }).promise;

    preview.innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${esc(pickedFile.name)}</b>
          <span>Page ${previewPageIndex + 1} of ${pageCount} · ${currentRotation}° rotation applied</span>
        </div>
      </div>
      <div class="preview-canvas"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(canvas);
  } catch (e) {
    console.error(e);
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Preview failed</b><span>${esc(e.message || "")}</span></div>`;
  }
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return toast("Add a PDF first.");
  if (currentRotation === 0) return toast("Rotate at least once before applying.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Rotating…`;

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const bytes = await pickedFile.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = doc.getPages();

    for (let i = 0; i < pages.length; i++) {
      const pct = (i / pages.length) * 90;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Rotating page ${i + 1} of ${pages.length}`;
      const p = pages[i];
      p.setRotation(degrees((p.getRotation().angle + currentRotation) % 360));
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving…";

    const out = await doc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "rotated.pdf";

    successBottomBar(url, filename);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    const pdfjs = await pdfjsLib.getDocument({ data: out }).promise;
    const pg = await pdfjs.getPage(1);
    const vp = pg.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${formatBytes(blob.size)} · rotated ${currentRotation}°</span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast("Rotated! Click Download.");
  } catch (e) {
    console.error(e);
    toast("Rotation failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Rotate PDF`;
  }
}

// ============================================================
// SUCCESS BAR
// ============================================================
function successBottomBar(url, filename) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download
    </a>
  `;
  $id("wsRename").onclick = () => openRename(filename, (newName) => {
    $id("wsDownload").setAttribute("download", newName);
    const nameEl = $id("wsResultName");
    if (nameEl) nameEl.textContent = newName;
  });
  $id("wsDownload").addEventListener("click", () => clearState("rotate"));
}

function openRename(current, onSave) {
  const box = document.createElement("div");
  box.className = "rename-box";
  box.innerHTML = `
    <div class="box">
      <h3>Rename file</h3>
      <input type="text" id="renameInput" value="${esc(current.replace(/\.pdf$/i, ""))}">
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
    let v = input.value.trim() || "rotated";
    if (!/\.pdf$/i.test(v)) v += ".pdf";
    onSave(v); toast(`Renamed to ${v}`); close();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("#renameSave").click();
    if (e.key === "Escape") close();
  });
}

// ============================================================
// EXPORT
// ============================================================
export const rotateTool = {
  id: "rotate",
  name: "Rotate PDF",
  desc: "Rotate all pages by 90°, 180°, or 270°.",
  icon: "fa-rotate-right",
  color: "#1e6b3a",
  mount
};