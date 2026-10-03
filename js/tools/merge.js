// js/tools/merge.js
// Merge PDFs — dedicated workspace with live preview, drag-reorder, and rename.

import { $id, esc, formatBytes, toast } from "./index.js";

const { PDFDocument } = PDFLib;

// ============================================================
// STATE
// ============================================================
let pickedFiles = [];
let dragSrcIdx = null;
let previewToken = 0;
let lastResult = null;   // { url, filename, blob, size }

// ============================================================
// MOUNT
// ============================================================
function mount(root, onExit) {
  pickedFiles = [];
  lastResult = null;

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1e6b3a"><i class="fa-solid fa-object-group"></i></div>
        <div>
          <h2>Merge PDFs</h2>
          <small>Combine 2 or more PDFs into a single file. Drag to reorder.</small>
        </div>
      </div>
    </div>

    <div class="ws-body">
      <aside class="ws-controls">
        <div class="ws-upload" id="wsUpload">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <b>Drop PDFs here</b>
          <span>or click to choose from your device</span>
          <button class="btn primary" id="wsChoose">
            <i class="fa-solid fa-folder-open"></i> Choose Files
          </button>
          <input type="file" id="wsInput" accept="application/pdf" multiple hidden>
        </div>

        <div id="wsError" class="err"></div>

        <div id="wsFileListBlock" class="hidden">
          <label style="font-size:12.5px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:8px;">
            Files to merge (top = first)
          </label>
          <ul class="ws-filelist" id="wsFileList"></ul>
          <p class="meta" style="margin-top:6px;font-size:11.5px;">
            <i class="fa-solid fa-grip-vertical"></i> Drag to reorder · <i class="fa-solid fa-xmark"></i> Remove
          </p>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty" id="wsPreviewEmpty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No files yet</b>
          <span>Add PDFs to see the merged result preview here.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-object-group"></i> Merge PDFs
        </button>
      </div>
    </div>
  `;

  // Wire top
  $id("wsBack").onclick = onExit;
  $id("wsCancel").onclick = onExit;

  // Wire upload
  const input = $id("wsInput");
  const chooseBtn = $id("wsChoose");
  const dropzone = $id("wsUpload");

  chooseBtn.onclick = () => input.click();
  input.addEventListener("change", (e) => {
    const files = [...e.target.files];
    if (files.length) addFiles(files);
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
    const files = [...e.dataTransfer.files].filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (files.length) addFiles(files);
    else toast("Please drop PDF files only.");
  });

  $id("wsProcess").onclick = process;
}

// ============================================================
// ADD FILES
// ============================================================
function addFiles(files) {
  pickedFiles = [...pickedFiles, ...files];
  lastResult = null;   // invalidate prior result
  renderFileList();
  updatePreview();
}

// ============================================================
// RENDER FILE LIST
// ============================================================
function renderFileList() {
  const block = $id("wsFileListBlock");
  const list = $id("wsFileList");
  const err = $id("wsError");
  const processBtn = $id("wsProcess");

  if (!pickedFiles.length) {
    block.classList.add("hidden");
    if (processBtn) processBtn.disabled = true;
    if (err) err.textContent = "";
    return;
  }

  block.classList.remove("hidden");

  list.innerHTML = pickedFiles
    .map(
      (f, i) => `
    <li draggable="true" data-idx="${i}">
      <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${formatBytes(f.size)}</span>
      <button type="button" class="file-remove" data-remove="${i}" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </li>`
    )
    .join("");

  if (pickedFiles.length < 2) {
    err.textContent = `You need at least 2 files to merge. You have ${pickedFiles.length}.`;
    if (processBtn) processBtn.disabled = true;
  } else {
    err.textContent = "";
    if (processBtn) processBtn.disabled = false;
  }

  wireReorder(list);
}

function wireReorder(list) {
  list.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    dragSrcIdx = +li.dataset.idx;
    li.classList.add("dragging");
  });

  list.addEventListener("dragend", () => {
    list.querySelectorAll("li").forEach((li) => li.classList.remove("dragging"));
    dragSrcIdx = null;
  });

  list.addEventListener("dragover", (e) => {
    e.preventDefault();
    const li = e.target.closest("li");
    if (!li || dragSrcIdx === null) return;
    const over = +li.dataset.idx;
    if (over === dragSrcIdx) return;

    const [moved] = pickedFiles.splice(dragSrcIdx, 1);
    pickedFiles.splice(over, 0, moved);
    dragSrcIdx = over;
    renderFileList();
    updatePreview();
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    pickedFiles.splice(+btn.dataset.remove, 1);
    lastResult = null;
    renderFileList();
    updatePreview();
  });
}

// ============================================================
// LIVE PREVIEW
// ============================================================
async function updatePreview() {
  const preview = $id("wsPreview");

  // Reset bottom bar to "ready to process" state
  resetBottomBar();

  if (!pickedFiles.length) {
    preview.innerHTML = `
      <div class="ws-empty">
        <i class="fa-solid fa-file-pdf"></i>
        <b>No files yet</b>
        <span>Add PDFs to see the merged result preview here.</span>
      </div>
    `;
    return;
  }

  preview.innerHTML = `<div class="ws-progress"><div class="ws-progress-bar"><i style="width:0%"></i></div><p class="ws-progress-label">Loading preview…</p></div>`;

  const myToken = ++previewToken;

  try {
    const out = await PDFDocument.create();
    for (const f of pickedFiles) {
      const bytes = await f.arrayBuffer();
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await src.getPageIndices();
      const copied = await out.copyPages(src, pages.slice(0, 1));
      copied.forEach((p) => out.addPage(p));
    }
    const mergedBytes = await out.save();
    if (myToken !== previewToken) return;

    const pdfjs = await pdfjsLib.getDocument({ data: mergedBytes }).promise;
    const page = await pdfjs.getPage(1);
    const vp = page.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (myToken !== previewToken) return;

    const totalBytes = pickedFiles.reduce((s, f) => s + f.size, 0);

    preview.innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${pickedFiles.length} file${pickedFiles.length > 1 ? "s" : ""} ready to merge</b>
          <span>${formatBytes(totalBytes)} · Preview of page 1</span>
        </div>
      </div>
      <div class="preview-canvas"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);
  } catch (e) {
    console.error(e);
    if (myToken === previewToken) {
      preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Couldn't load preview</b><span>The files may be password-protected or corrupt.</span></div>`;
    }
  }
}

// ============================================================
// BOTTOM BAR STATES
// ============================================================
function resetBottomBar() {
  const right = $id("wsActionsRight");
  if (!right) return;
  right.innerHTML = `
    <button class="btn primary" id="wsProcess" ${pickedFiles.length < 2 ? "disabled" : ""}>
      <i class="fa-solid fa-object-group"></i> Merge PDFs
    </button>
  `;
  $id("wsProcess").onclick = process;
}

function successBottomBar() {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename">
      <i class="fa-solid fa-pen"></i> Rename
    </button>
    <button class="btn" id="wsAnother">
      <i class="fa-solid fa-plus"></i> Merge another
    </button>
    <a class="btn primary" id="wsDownload"
       href="${lastResult.url}"
       download="${esc(lastResult.filename)}"
       style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download
    </a>
  `;

  $id("wsRename").onclick = openRenameDialog;
  $id("wsAnother").onclick = () => {
    pickedFiles = [];
    lastResult = null;
    renderFileList();
    updatePreview();
  };
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  const processBtn = $id("wsProcess");
  if (processBtn) {
    processBtn.disabled = true;
    processBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Merging…`;
  }

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const out = await PDFDocument.create();
    for (let i = 0; i < pickedFiles.length; i++) {
      const f = pickedFiles[i];
      const pct = (i / pickedFiles.length) * 100;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Adding "${f.name}" (${i + 1} of ${pickedFiles.length})`;

      const bytes = await f.arrayBuffer();
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving merged PDF…";

    const merged = await out.save();
    const blob = new Blob([merged], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "merged.pdf";

    lastResult = { url, filename, blob, size: blob.size };

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    // Result card (no download button — that lives in the bottom bar)
    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${formatBytes(blob.size)} · ready</span>
        <span style="font-size:12px;color:var(--text-light);margin-top:8px">
          <i class="fa-solid fa-arrow-down"></i> Click <b>Download</b> below
        </span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;

    // Render result preview
    try {
      const pdfjs = await pdfjsLib.getDocument({ data: merged }).promise;
      const page = await pdfjs.getPage(1);
      const vp = page.getViewport({ scale: 0.9 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      preview.querySelector(".preview-canvas").appendChild(c);
    } catch (e) { console.warn(e); }

    // Swap bottom bar to success state
    successBottomBar();

    // Toast
    toast("Merged! Click Download to save.");
  } catch (err) {
    console.error(err);
    toast("Merge failed. Check the files and try again.");
    if (processBtn) {
      processBtn.disabled = false;
      processBtn.innerHTML = `<i class="fa-solid fa-object-group"></i> Merge PDFs`;
    }
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Merge failed</b><span>${esc(err.message || "Try again with different files.")}</span></div>`;
  }
}

// ============================================================
// RENAME DIALOG
// ============================================================
function openRenameDialog() {
  if (!lastResult) return;

  const current = lastResult.filename.replace(/\.pdf$/i, "");
  const box = document.createElement("div");
  box.className = "rename-box";
  box.innerHTML = `
    <div class="box">
      <h3>Rename file</h3>
      <input type="text" id="renameInput" value="${esc(current)}" placeholder="File name">
      <div class="actions">
        <button class="btn" id="renameCancel">Cancel</button>
        <button class="btn primary" id="renameSave">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(box);

  const input = box.querySelector("#renameInput");
  input.focus();
  input.select();

  const close = () => box.remove();

  box.querySelector("#renameCancel").onclick = close;
  box.querySelector("#renameSave").onclick = () => {
    let newName = input.value.trim() || "merged";
    if (!/\.pdf$/i.test(newName)) newName += ".pdf";
    lastResult.filename = newName;

    // Update download button
    const dl = $id("wsDownload");
    if (dl) {
      dl.setAttribute("download", newName);
    }

    // Update result card name
    const nameEl = $id("wsResultName");
    if (nameEl) nameEl.textContent = newName;

    toast(`Renamed to ${newName}`);
    close();
  };

  // Enter to save, Escape to cancel
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("#renameSave").click();
    if (e.key === "Escape") close();
  });
}

// ============================================================
// EXPORT
// ============================================================
export const mergeTool = {
  id: "merge",
  name: "Merge PDFs",
  desc: "Combine 2 or more PDFs into one file.",
  icon: "fa-object-group",
  color: "#1e6b3a",
  mount
};