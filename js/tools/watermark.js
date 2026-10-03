// js/tools/watermark.js
// Watermark — text watermark, drag-to-place on the live preview.

import { $id, esc, formatBytes, toast } from "./index.js";

const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;

// ============================================================
// STATE
// ============================================================
let pickedFile = null;
let previewPdf = null;         // pdf-lib doc, cloned for each preview render
let previewPageIndex = 0;      // current page being previewed
let pageCount = 0;
let previewCanvas = null;
let canvasCtx = null;
let previewScale = 1;

// Watermark position, stored as fraction of page (0..1)
let pos = { x: 0.5, y: 0.5 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// ============================================================
// MOUNT
// ============================================================
function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  previewPageIndex = 0;
  pageCount = 0;
  pos = { x: 0.5, y: 0.5 };

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1a6dff"><i class="fa-solid fa-droplet"></i></div>
        <div>
          <h2>Add Watermark</h2>
          <small>Stamp text across your PDF. Drag the text on the preview to move it.</small>
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
            <label>Watermark text</label>
            <input type="text" id="wmText" value="CONFIDENTIAL" placeholder="e.g. CONFIDENTIAL">
          </div>

          <div class="ws-field">
            <label>Opacity (0.05 – 1)</label>
            <input type="range" id="wmOpacity" min="0.05" max="1" step="0.05" value="0.25">
            <small id="wmOpacityLabel">25%</small>
          </div>

          <div class="ws-field">
            <label>Font size</label>
            <input type="range" id="wmSize" min="20" max="120" step="2" value="60">
            <small id="wmSizeLabel">60 pt</small>
          </div>

          <div class="ws-field">
            <label>Rotation</label>
            <select id="wmRotation">
              <option value="0">Horizontal (0°)</option>
              <option value="45" selected>Diagonal (45°)</option>
              <option value="90">Vertical (90°)</option>
              <option value="315">Diagonal (-45°)</option>
            </select>
          </div>

          <div class="ws-field">
            <label>Preview page</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn" id="wmPrevPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-left"></i></button>
              <span style="flex:1;text-align:center;font-weight:700;color:var(--text-soft)">
                <span id="wmPageNum">1</span> / <span id="wmPageTotal">—</span>
              </span>
              <button class="btn" id="wmNextPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>

          <div class="ws-field">
            <label>Position</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" data-pos="tl" style="flex:1;padding:6px 10px">↖ Top-left</button>
              <button class="btn" data-pos="tc" style="flex:1;padding:6px 10px">↑ Top</button>
              <button class="btn" data-pos="tr" style="flex:1;padding:6px 10px">↗ Top-right</button>
              <button class="btn" data-pos="c" style="flex:1;padding:6px 10px">◎ Center</button>
              <button class="btn" data-pos="bl" style="flex:1;padding:6px 10px">↙ Bottom-left</button>
              <button class="btn" data-pos="bc" style="flex:1;padding:6px 10px">↓ Bottom</button>
              <button class="btn" data-pos="br" style="flex:1;padding:6px 10px">↘ Bottom-right</button>
            </div>
            <small>Or drag the watermark on the preview.</small>
          </div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to preview and place your watermark.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-droplet"></i> Apply Watermark
        </button>
      </div>
    </div>
  `;

  // Wire top
  $id("wsBack").onclick = onExit;
  $id("wsCancel").onclick = onExit;

  // Upload
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

  // Options listeners (rebuild preview on change)
  document.querySelectorAll("[data-pos]").forEach((b) => {
    b.onclick = () => {
      const map = {
        tl: { x: 0.15, y: 0.9 }, tc: { x: 0.5, y: 0.9 }, tr: { x: 0.85, y: 0.9 },
        c:  { x: 0.5,  y: 0.5 }, bl: { x: 0.15, y: 0.1 }, bc: { x: 0.5, y: 0.1 }, br: { x: 0.85, y: 0.1 }
      };
      pos = map[b.dataset.pos];
      renderPreview();
    };
  });
  $id("wmOpacity").oninput = (e) => {
    $id("wmOpacityLabel").textContent = Math.round(e.target.value * 100) + "%";
    renderPreview();
  };
  $id("wmSize").oninput = (e) => {
    $id("wmSizeLabel").textContent = e.target.value + " pt";
    renderPreview();
  };
  $id("wmText").oninput = renderPreview;
  $id("wmRotation").onchange = renderPreview;

  $id("wmPrevPage").onclick = () => {
    if (previewPageIndex > 0) { previewPageIndex--; renderPreview(); }
  };
  $id("wmNextPage").onclick = () => {
    if (previewPageIndex < pageCount - 1) { previewPageIndex++; renderPreview(); }
  };

  $id("wsProcess").onclick = process;
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
    previewPageIndex = 0;
    pickedFile = file;

    $id("wmPageTotal").textContent = pageCount;
    $id("wmPageNum").textContent = previewPageIndex + 1;
    $id("wsOptionsBlock").classList.remove("hidden");
    $id("wsProcess").disabled = false;

    renderPreview();
  } catch (e) {
    console.error(e);
    err.textContent = "Couldn't open this PDF. It may be password-protected.";
  }
}

// ============================================================
// RENDER PREVIEW — draws the page, then draws watermark overlay
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
    previewScale = targetWidth / vp.width;
    const finalVp = page.getViewport({ scale: previewScale });

    preview.innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${esc(pickedFile.name)}</b>
          <span>Page ${previewPageIndex + 1} of ${pageCount} · ${formatBytes(pickedFile.size)}</span>
        </div>
      </div>
      <div class="wm-stage" id="wmStage" style="width:${finalVp.width}px;height:${finalVp.height}px"></div>
    `;

    const stage = $id("wmStage");
    const canvas = document.createElement("canvas");
    canvas.width = finalVp.width;
    canvas.height = finalVp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: finalVp }).promise;
    stage.appendChild(canvas);

    // Overlay: the watermark text rendered as an HTML element the user can drag
    const overlay = document.createElement("div");
    overlay.className = "wm-overlay";
    overlay.id = "wmOverlay";
    overlay.textContent = $id("wmText").value || "CONFIDENTIAL";
    overlay.style.left = (pos.x * 100) + "%";
    overlay.style.top = ((1 - pos.y) * 100) + "%";
    overlay.style.transform = "translate(-50%, -50%) " + overlayTransform();
    overlay.style.fontSize = (parseInt($id("wmSize").value) * previewScale) + "px";
    overlay.style.opacity = $id("wmOpacity").value;
    stage.appendChild(overlay);

    wireOverlayDrag(stage, overlay);
  } catch (e) {
    console.error(e);
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Preview failed</b><span>${esc(e.message || "")}</span></div>`;
  }
}

function overlayTransform() {
  const rot = parseInt($id("wmRotation").value) || 0;
  // CSS rotation is clockwise; PDF-lib uses counterclockwise positive.
  return `rotate(${rot}deg)`;
}

// ============================================================
// DRAG
// ============================================================
function wireOverlayDrag(stage, overlay) {
  overlay.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    isDragging = true;
    overlay.setPointerCapture(e.pointerId);
    overlay.classList.add("dragging");
  });

  overlay.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const rect = stage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    pos.x = Math.max(0.02, Math.min(0.98, x));
    pos.y = Math.max(0.02, Math.min(0.98, y));
    overlay.style.left = (pos.x * 100) + "%";
    overlay.style.top = ((1 - pos.y) * 100) + "%";
  });

  overlay.addEventListener("pointerup", () => {
    isDragging = false;
    overlay.classList.remove("dragging");
  });

  overlay.addEventListener("pointercancel", () => {
    isDragging = false;
    overlay.classList.remove("dragging");
  });
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return;

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Applying…`;

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
    const font = await doc.embedFont(StandardFonts.HelveticaBold);

    const text = $id("wmText").value || "CONFIDENTIAL";
    const opacity = parseFloat($id("wmOpacity").value);
    const size = parseInt($id("wmSize").value);
    const rotation = parseInt($id("wmRotation").value);

    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const pct = (i / pages.length) * 100;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Watermarking page ${i + 1} of ${pages.length}`;

      const p = pages[i];
      const { width: w, height: h } = p.getSize();
      const textWidth = font.widthOfTextAtSize(text, size);
      // Position by left edge of the text (PDF origin = bottom-left)
      const x = pos.x * w - textWidth / 2;
      const y = pos.y * h - size / 2;

      p.drawText(text, {
        x, y,
        size,
        font,
        rotate: degrees(rotation),
        opacity: Math.min(1, Math.max(0.05, opacity)),
        color: rgb(0.3, 0.3, 0.3)
      });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving…";

    const out = await doc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "watermarked.pdf";

    successBottomBar(url, filename, blob.size);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    // Render final result
    const pdfjs = await pdfjsLib.getDocument({ data: out }).promise;
    const page = await pdfjs.getPage(1);
    const vp = page.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${formatBytes(blob.size)} · ready</span>
        <span style="font-size:12px;color:var(--text-light);margin-top:8px">
          <i class="fa-solid fa-arrow-down"></i> Use <b>Download</b> below
        </span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast("Watermark applied! Click Download.");
  } catch (e) {
    console.error(e);
    toast("Watermark failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-droplet"></i> Apply Watermark`;
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Watermark failed</b><span>${esc(e.message || "")}</span></div>`;
  }
}

// ============================================================
// SUCCESS BOTTOM BAR
// ============================================================
function successBottomBar(url, filename, size) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <button class="btn" id="wsAnother"><i class="fa-solid fa-plus"></i> New file</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download
    </a>
  `;
  $id("wsRename").onclick = () => openRename(filename, (newName) => {
    $id("wsDownload").setAttribute("download", newName);
    const nameEl = $id("wsResultName");
    if (nameEl) nameEl.textContent = newName;
  });
  $id("wsAnother").onclick = () => {
    // Reset the workspace
    const tool = { mount }; // re-mount self
    location.reload();
  };
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
    let v = input.value.trim() || "output";
    if (!/\.pdf$/i.test(v)) v += ".pdf";
    onSave(v);
    toast(`Renamed to ${v}`);
    close();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("#renameSave").click();
    if (e.key === "Escape") close();
  });
}

// ============================================================
// EXPORT
// ============================================================
export const watermarkTool = {
  id: "watermark",
  name: "Add Watermark",
  desc: "Stamp text across your PDF. Drag to place it anywhere.",
  icon: "fa-droplet",
  color: "#1a6dff",
  mount
};