// js/tools/compress.js
// Compress PDF — reduces file size by re-rendering pages as images.
// Shows before/after size and warns if compression wouldn't help.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument } = PDFLib;

let pickedFile = null;
let previewPdf = null;
let previewPageIndex = 0;
let pageCount = 0;

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  previewPageIndex = 0;
  pageCount = 0;

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1a6dff"><i class="fa-solid fa-compress"></i></div>
        <div>
          <h2>Compress PDF</h2>
          <small>Reduce file size by re-saving pages as compressed images.</small>
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
            <label>Compression level</label>
            <select id="cpLevel">
              <option value="low">Smaller file (best compression)</option>
              <option value="medium" selected>Balanced (recommended)</option>
              <option value="high">Better quality (bigger file)</option>
            </select>
            <small>Higher quality = larger file. Balanced works for most documents.</small>
          </div>

          <div class="ws-field">
            <label>Preview page</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn" id="cpPrevPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-left"></i></button>
              <span style="flex:1;text-align:center;font-weight:700;color:var(--text-soft)">
                <span id="cpPageNum">1</span> / <span id="cpPageTotal">—</span>
              </span>
              <button class="btn" id="cpNextPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>

          <div class="info-card" id="cpInfo">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>How it works</b>
              <span>Pages are re-saved as JPEG images and rebuilt into a PDF. Text will no longer be selectable in the output.</span>
            </div>
          </div>

        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to see the compression preview.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-compress"></i> Compress PDF
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

  $id("cpPrevPage").onclick = () => {
    if (previewPageIndex > 0) { previewPageIndex--; renderPreview(); persistState(); }
  };
  $id("cpNextPage").onclick = () => {
    if (previewPageIndex < pageCount - 1) { previewPageIndex++; renderPreview(); persistState(); }
  };

  $id("cpLevel").onchange = () => {
    renderPreview();
    persistState();
  };

  $id("wsProcess").onclick = process;

  // Restore
  try {
    const saved = await loadState("compress");
    if (saved) {
      if (saved.opts.level) $id("cpLevel").value = saved.opts.level;
      if (saved.opts.previewPageIndex) previewPageIndex = saved.opts.previewPageIndex;
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
  saveState("compress", {
    level: $id("cpLevel")?.value,
    previewPageIndex
  }, pickedFile ? [pickedFile] : []);
}

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

    $id("cpPageTotal").textContent = pageCount;
    $id("cpPageNum").textContent = previewPageIndex + 1;
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
    const vp = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(680, preview.clientWidth - 40);
    const scale = targetWidth / vp.width;
    const finalVp = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = finalVp.width;
    canvas.height = finalVp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: finalVp }).promise;

    const originalSize = pickedFile.size;

    preview.innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${esc(pickedFile.name)}</b>
          <span>Page ${previewPageIndex + 1} of ${pageCount} · <b>${formatBytes(originalSize)}</b> original</span>
        </div>
      </div>
      <div class="preview-canvas"></div>
      <div class="size-compare" id="sizeCompare">
        <div class="size-col">
          <span class="size-label">Original</span>
          <b>${formatBytes(originalSize)}</b>
        </div>
        <i class="fa-solid fa-arrow-right"></i>
        <div class="size-col">
          <span class="size-label">After compression</span>
          <b id="compressedSizeEstimate">…</b>
        </div>
      </div>
    `;
    preview.querySelector(".preview-canvas").appendChild(canvas);

    // Estimate — quickly compress just the first page
    estimateSize();
  } catch (e) {
    console.error(e);
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Preview failed</b><span>${esc(e.message || "")}</span></div>`;
  }
}

// ============================================================
// ESTIMATE — quick pass, one page, scale down
// ============================================================
async function estimateSize() {
  const el = $id("compressedSizeEstimate");
  if (!el) return;
  const level = $id("cpLevel").value;
  const jpegQuality = { low: 0.5, medium: 0.7, high: 0.85 }[level] || 0.7;

  try {
    const bytes = await pickedFile.arrayBuffer();
    const pdfjs = await pdfjsLib.getDocument({ data: bytes }).promise;
    // Sample 3 pages max, average the compressed size, extrapolate
    const sampleN = Math.min(3, pdfjs.numPages);
    let totalSampledSize = 0;

    for (let i = 1; i <= sampleN; i++) {
      const page = await pdfjs.getPage(i);
      const vp = page.getViewport({ scale: 1.2 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", jpegQuality));
      totalSampledSize += blob.size;
    }

    const avgPerPage = totalSampledSize / sampleN;
    const estimatedTotal = avgPerPage * pdfjs.numPages * 0.95;
    el.textContent = "~" + formatBytes(estimatedTotal);
  } catch (e) {
    console.warn(e);
    el.textContent = "—";
  }
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return toast("Add a PDF first.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Compressing…`;

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const level = $id("cpLevel").value;
    const jpegQuality = { low: 0.5, medium: 0.7, high: 0.85 }[level] || 0.7;
    const scale = { low: 1.1, medium: 1.3, high: 1.5 }[level] || 1.3;

    const bytes = await pickedFile.arrayBuffer();
    const pdfjs = await pdfjsLib.getDocument({ data: bytes }).promise;
    const total = pdfjs.numPages;

    const out = await PDFDocument.create();

    for (let i = 1; i <= total; i++) {
      const pct = (i / total) * 90;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Compressing page ${i} of ${total}`;

      const page = await pdfjs.getPage(i);
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", jpegQuality));
      const jpgBytes = await blob.arrayBuffer();
      const img = await out.embedJpg(jpgBytes);
      const pg = out.addPage([vp.width / scale, vp.height / scale]);
      pg.drawImage(img, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving…";

    const outBytes = await out.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });

    if (blob.size >= pickedFile.size) {
      // Nothing to gain
      $id("wsProgressFill").style.width = "100%";
      $id("wsProgressLabel").textContent = "Finished";
      toast("This PDF is already small — compression would make it bigger.");
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-compress"></i> Try a lower quality`;
      renderPreview();
      return;
    }

    const url = URL.createObjectURL(blob);
    const filename = "compressed.pdf";
    const savedBytes = pickedFile.size - blob.size;
    const savedPct = Math.round((savedBytes / pickedFile.size) * 100);

    successBottomBar(url, filename, blob.size, pickedFile.size, savedPct);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    const pdfjs2 = await pdfjsLib.getDocument({ data: outBytes }).promise;
    const pg = await pdfjs2.getPage(1);
    const vp = pg.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${formatBytes(blob.size)} · saved ${formatBytes(savedBytes)} (${savedPct}%)</span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast(`Saved ${savedPct}% — click Download`);
  } catch (e) {
    console.error(e);
    toast("Compression failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-compress"></i> Compress PDF`;
  }
}

// ============================================================
// SUCCESS BAR
// ============================================================
function successBottomBar(url, filename, size, originalSize, savedPct) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download (${savedPct}% smaller)
    </a>
  `;
  $id("wsRename").onclick = () => openRename(filename, (newName) => {
    $id("wsDownload").setAttribute("download", newName);
    const nameEl = $id("wsResultName");
    if (nameEl) nameEl.textContent = newName;
  });
  $id("wsDownload").addEventListener("click", () => clearState("compress"));
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
    let v = input.value.trim() || "compressed";
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
export const compressTool = {
  id: "compress",
  name: "Compress PDF",
  desc: "Reduce file size by re-saving pages as compressed images.",
  icon: "fa-compress",
  color: "#1a6dff",
  mount
};