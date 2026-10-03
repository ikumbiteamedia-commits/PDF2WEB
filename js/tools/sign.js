// js/tools/sign.js
// Sign PDF — draw a signature OR upload an image. Drag to place it.
// State persists for 1 week unless the user downloads a result.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument, rgb, StandardFonts } = PDFLib;

let pickedFile = null;
let previewPdf = null;
let previewPageIndex = 0;
let pageCount = 0;
let previewScale = 1;
let pos = { x: 0.85, y: 0.1 };
let sigDataUrl = null;
let isDragging = false;

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  previewPageIndex = 0;
  pageCount = 0;
  pos = { x: 0.85, y: 0.1 };
  sigDataUrl = null;

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#1e6b3a"><i class="fa-solid fa-signature"></i></div>
        <div>
          <h2>Sign PDF</h2>
          <small>Draw a signature or upload an image. Drag it on the preview to place it.</small>
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

        <div id="wsOptionsBlock" style="display:flex;flex-direction:column;gap:14px">

          <div class="ws-field">
            <label>Signature source</label>
            <div style="display:flex;gap:6px">
              <button class="btn primary" id="tabDraw" style="flex:1;justify-content:center">
                <i class="fa-solid fa-pen"></i> Draw
              </button>
              <button class="btn" id="tabUpload" style="flex:1;justify-content:center">
                <i class="fa-solid fa-upload"></i> Upload
              </button>
            </div>
          </div>

          <div id="paneDraw" class="ws-field">
            <label>Draw your signature</label>
            <canvas id="sigPad" width="600" height="180"
                    style="width:100%;border:2px dashed var(--border-strong);border-radius:12px;background:#fff;touch-action:none"></canvas>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn" id="sigClear" style="flex:1">Clear</button>
              <button class="btn primary" id="sigUse" style="flex:1">
                <i class="fa-solid fa-check"></i> Use signature
              </button>
            </div>
          </div>

          <div id="paneUpload" class="ws-field hidden">
            <label>Upload a signature image</label>
            <div class="ws-upload" id="sigUploadZone" style="padding:18px 14px">
              <i class="fa-solid fa-image"></i>
              <b>Drop a PNG or JPG</b>
              <span>or click to browse</span>
              <button class="btn primary" id="sigUploadBtn">
                <i class="fa-solid fa-folder-open"></i> Choose image
              </button>
              <input type="file" id="sigUploadInput" accept="image/png,image/jpeg" hidden>
            </div>
            <div id="sigUploadPreview" class="hidden" style="margin-top:8px;text-align:center">
              <img id="sigUploadImg" style="max-width:100%;max-height:120px;border:1px solid var(--border);border-radius:8px;background:#fff;padding:6px">
            </div>
          </div>

          <div class="ws-field">
            <label>Signature size</label>
            <input type="range" id="signSize" min="0.08" max="0.5" step="0.02" value="0.2">
            <small id="signSizeLabel">20% of page width</small>
          </div>

          <div class="ws-field">
            <label>Preview page</label>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn" id="sgPrevPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-left"></i></button>
              <span style="flex:1;text-align:center;font-weight:700;color:var(--text-soft)">
                <span id="sgPageNum">1</span> / <span id="sgPageTotal">—</span>
              </span>
              <button class="btn" id="sgNextPage" type="button" style="padding:6px 12px"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>

          <div class="ws-field">
            <label>Quick position</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn" data-pos="bl" style="flex:1;padding:6px 10px">↙ Bottom-left</button>
              <button class="btn" data-pos="bc" style="flex:1;padding:6px 10px">↓ Bottom</button>
              <button class="btn" data-pos="br" style="flex:1;padding:6px 10px">↘ Bottom-right</button>
            </div>
            <small>Or drag the signature on the preview.</small>
          </div>

          <div class="ws-toggle">
            <label for="signDate" class="ws-toggle-label">
              <span>Add today's date</span>
              <input type="checkbox" id="signDate">
              <span class="ws-switch"></span>
            </label>
            <small style="display:block;color:var(--text-light);font-size:11.5px;margin-top:6px">
              Adds "Signed on [date]" under the signature.
            </small>
          </div>

        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to preview and place your signature.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-signature"></i> Apply Signature
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

  $id("tabDraw").onclick = () => {
    $id("tabDraw").classList.add("primary");
    $id("tabUpload").classList.remove("primary");
    $id("paneDraw").classList.remove("hidden");
    $id("paneUpload").classList.add("hidden");
  };
  $id("tabUpload").onclick = () => {
    $id("tabUpload").classList.add("primary");
    $id("tabDraw").classList.remove("primary");
    $id("paneUpload").classList.remove("hidden");
    $id("paneDraw").classList.add("hidden");
  };

  setupSignaturePad();
  $id("sigClear").onclick = () => {
    const c = $id("sigPad");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    delete c.dataset.drawn;
    sigDataUrl = null;
    $id("sigUploadPreview").classList.add("hidden");
    updateProcessState();
    renderPreview();
    persistState();
  };
  $id("sigUse").onclick = () => {
    const c = $id("sigPad");
    if (!c.dataset.drawn) return toast("Draw a signature first.");
    sigDataUrl = c.toDataURL("image/png");
    updateProcessState();
    renderPreview();
    persistState();
    toast("Signature attached — drag it on the preview");
  };

  const upInput = $id("sigUploadInput");
  $id("sigUploadBtn").onclick = () => upInput.click();
  upInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadSignatureImage(f);
    e.target.value = "";
  });
  const zone = $id("sigUploadZone");
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
    })
  );
  zone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) loadSignatureImage(f);
    else toast("Please drop a PNG or JPG.");
  });

  $id("signSize").oninput = (e) => {
    $id("signSizeLabel").textContent = Math.round(e.target.value * 100) + "% of page width";
    renderPreview();
    persistState();
  };

  $id("sgPrevPage").onclick = () => {
    if (previewPageIndex > 0) { previewPageIndex--; renderPreview(); persistState(); }
  };
  $id("sgNextPage").onclick = () => {
    if (previewPageIndex < pageCount - 1) { previewPageIndex++; renderPreview(); persistState(); }
  };

  document.querySelectorAll("[data-pos]").forEach((b) => {
    b.onclick = () => {
      const map = { bl: { x: 0.15, y: 0.1 }, bc: { x: 0.5, y: 0.1 }, br: { x: 0.85, y: 0.1 } };
      pos = map[b.dataset.pos];
      renderPreview();
      persistState();
    };
  });

  $id("signDate").onchange = () => {
    renderPreview();
    persistState();
  };

  $id("wsProcess").onclick = process;

  // Restore
  try {
    const saved = await loadState("sign");
    if (saved) {
      if (saved.opts.pos) pos = saved.opts.pos;
      if (saved.opts.signSize) $id("signSize").value = saved.opts.signSize;
      if (saved.opts.previewPageIndex) previewPageIndex = saved.opts.previewPageIndex;
      if (saved.opts.sigDataUrl) {
        sigDataUrl = saved.opts.sigDataUrl;
        $id("sigUploadPreview").classList.remove("hidden");
        $id("sigUploadImg").src = sigDataUrl;
      }
      if (saved.opts.signDate) $id("signDate").checked = true;
      $id("signSizeLabel").textContent = Math.round(parseFloat($id("signSize").value) * 100) + "% of page width";

      if (saved.files && saved.files.length) {
        await pickFile(saved.files[0]);
        toast("Restored your previous session");
      }
    }
  } catch (e) {
    console.warn("Restore failed:", e);
  }
}

// ============================================================
// PERSIST
// ============================================================
function persistState() {
  saveState("sign", {
    pos,
    signSize: $id("signSize")?.value,
    previewPageIndex,
    sigDataUrl,
    signDate: $id("signDate")?.checked
  }, pickedFile ? [pickedFile] : []);
}

// ============================================================
// SIGNATURE UPLOAD
// ============================================================
function loadSignatureImage(file) {
  if (!/^image\//.test(file.type)) return toast("Only PNG or JPG images.");
  const reader = new FileReader();
  reader.onload = () => {
    sigDataUrl = reader.result;
    $id("sigUploadPreview").classList.remove("hidden");
    $id("sigUploadImg").src = sigDataUrl;
    updateProcessState();
    renderPreview();
    persistState();
    toast("Signature loaded — drag it on the preview");
  };
  reader.readAsDataURL(file);
}

// ============================================================
// SIGNATURE PAD
// ============================================================
function setupSignaturePad() {
  const c = $id("sigPad");
  const x = c.getContext("2d");
  x.lineWidth = 3;
  x.lineCap = "round";
  x.strokeStyle = "#1a1a1a";
  let drawing = false;
  const pt = (e) => {
    const r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height
    ];
  };
  c.onpointerdown = (e) => {
    drawing = true;
    c.dataset.drawn = "1";
    x.beginPath();
    x.moveTo(...pt(e));
    c.setPointerCapture(e.pointerId);
  };
  c.onpointermove = (e) => {
    if (!drawing) return;
    x.lineTo(...pt(e));
    x.stroke();
  };
  c.onpointerup = () => (drawing = false);
}

// ============================================================
// PICK PDF
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

    $id("sgPageTotal").textContent = pageCount;
    $id("sgPageNum").textContent = previewPageIndex + 1;
    updateProcessState();
    renderPreview();
    persistState();
  } catch (e) {
    console.error(e);
    err.textContent = "Couldn't open this PDF. It may be password-protected.";
  }
}

function updateProcessState() {
  const btn = $id("wsProcess");
  if (!pickedFile || !sigDataUrl) { btn.disabled = true; return; }
  btn.disabled = false;
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

    if (sigDataUrl) {
      const sizeFactor = parseFloat($id("signSize").value);
      const sigWidthPx = finalVp.width * sizeFactor;

      const overlay = document.createElement("img");
      overlay.id = "sigOverlay";
      overlay.src = sigDataUrl;
      overlay.className = "sig-overlay";
      overlay.style.width = sigWidthPx + "px";
      overlay.style.left = (pos.x * 100) + "%";
      overlay.style.top = ((1 - pos.y) * 100) + "%";
      overlay.style.transform = "translate(-50%, -50%)";
      stage.appendChild(overlay);
      wireSignatureDrag(stage, overlay);

      // Date ghost — placed right below the signature using its real height
      if ($id("signDate").checked) {
        // Wait for the image to load so offsetHeight is correct
        const placeGhost = () => {
          const sigHalfHeight = (overlay.offsetHeight || 40) / 2;
          const ghost = document.createElement("div");
          ghost.className = "sig-date-ghost";
          ghost.textContent = "Signed on " + new Date().toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", year: "numeric"
          });
          ghost.style.left = (pos.x * 100) + "%";
          ghost.style.top = `calc(${(1 - pos.y) * 100}% + ${sigHalfHeight + 8}px)`;
          ghost.style.transform = "translate(-50%, 0)";
          stage.appendChild(ghost);
        };
        if (overlay.complete) placeGhost();
        else overlay.onload = placeGhost;
      }
    }
  } catch (e) {
    console.error(e);
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-triangle-exclamation"></i><b>Preview failed</b><span>${esc(e.message || "")}</span></div>`;
  }
}

function wireSignatureDrag(stage, overlay) {
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

    // Move date ghost with the signature
    const ghost = stage.querySelector(".sig-date-ghost");
    if (ghost) {
      const sigHalfHeight = (overlay.offsetHeight || 40) / 2;
      ghost.style.left = (pos.x * 100) + "%";
      ghost.style.top = `calc(${(1 - pos.y) * 100}% + ${sigHalfHeight + 8}px)`;
    }
  });
  const end = () => {
    isDragging = false;
    overlay.classList.remove("dragging");
    persistState();
  };
  overlay.addEventListener("pointerup", end);
  overlay.addEventListener("pointercancel", end);
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return toast("Add a PDF first.");
  if (!sigDataUrl) return toast("Draw or upload a signature first.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing…`;

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
    const png = await doc.embedPng(sigDataUrl);

    const sizeFactor = parseFloat($id("signSize").value);
    const includeDate = $id("signDate").checked;

    const pages = doc.getPages();
    const p = pages[previewPageIndex];
    const { width: w, height: h } = p.getSize();
    const sigW = w * sizeFactor;
    const sigH = (sigW * png.height) / png.width;
    const sigX = pos.x * w - sigW / 2;
    const sigY = pos.y * h - sigH / 2;

    $id("wsProgressFill").style.width = "60%";
    $id("wsProgressLabel").textContent = "Placing signature…";

    p.drawImage(png, { x: sigX, y: sigY, width: sigW, height: sigH });

    if (includeDate) {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const dateStr = "Signed on " + new Date().toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric"
      });
      const dateSize = 11;
      const dateWidth = font.widthOfTextAtSize(dateStr, dateSize);

      const dateY = Math.max(20, sigY - 22);
      const dateX = Math.max(10, Math.min(w - dateWidth - 10, sigX + (sigW - dateWidth) / 2));

      p.drawText(dateStr, {
        x: dateX,
        y: dateY,
        size: dateSize,
        font,
        color: rgb(0.35, 0.35, 0.35)
      });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving…";

    const out = await doc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "signed.pdf";

    successBottomBar(url, filename, blob.size);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    const pdfjs = await pdfjsLib.getDocument({ data: out }).promise;
    const pg = await pdfjs.getPage(previewPageIndex + 1);
    const vp = pg.getViewport({ scale: 0.9 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(filename)}</b>
        <span>${formatBytes(blob.size)} · ready</span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast("Signed! Click Download.");
  } catch (e) {
    console.error(e);
    toast("Signing failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-signature"></i> Apply Signature`;
  }
}

// ============================================================
// SUCCESS BAR
// ============================================================
function successBottomBar(url, filename, size) {
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
        <input type="text" id="renameInput" value="signed">
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
      let v = input.value.trim() || "signed";
      if (!/\.pdf$/i.test(v)) v += ".pdf";
      $id("wsDownload").setAttribute("download", v);
      const nameEl = $id("wsResultName");
      if (nameEl) nameEl.textContent = v;
      toast(`Renamed to ${v}`);
      close();
    };
  };

  $id("wsDownload").addEventListener("click", () => {
    clearState("sign");
  });
}

// ============================================================
// EXPORT
// ============================================================
export const signTool = {
  id: "sign",
  name: "Sign PDF",
  desc: "Draw or upload a signature and place it on your PDF.",
  icon: "fa-signature",
  color: "#1e6b3a",
  mount
};