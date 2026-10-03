// js/tools/pdf2jpg.js
// PDF → Images — export every page as a JPG. Zipped if more than one.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument } = PDFLib;

let pickedFile = null;
let pdfDoc = null;
let pageCount = 0;

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  pdfDoc = null;
  pageCount = 0;

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#dc3545"><i class="fa-solid fa-file-image"></i></div>
        <div>
          <h2>PDF to Images</h2>
          <small>Export every page as a JPG. Multiple pages are zipped automatically.</small>
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
            <label>Image quality</label>
            <select id="p2jQuality">
              <option value="0.7">Standard (smaller files)</option>
              <option value="0.9" selected>High (recommended)</option>
              <option value="1.0">Maximum quality</option>
            </select>
          </div>

          <div class="ws-field">
            <label>Resolution</label>
            <select id="p2jScale">
              <option value="1.5">72 DPI (screen)</option>
              <option value="2" selected>144 DPI (recommended)</option>
              <option value="3">216 DPI (print)</option>
            </select>
          </div>

          <div class="info-card">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>Multi-page PDFs</b>
              <span>You'll get a ZIP file with one JPG per page, named page-001.jpg, page-002.jpg, etc.</span>
            </div>
          </div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to preview the exported images.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-file-image"></i> Export Images
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

  $id("wsProcess").onclick = process;

  try {
    const saved = await loadState("pdf2jpg");
    if (saved) {
      if (saved.opts.quality) $id("p2jQuality").value = saved.opts.quality;
      if (saved.opts.scale) $id("p2jScale").value = saved.opts.scale;
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
  saveState("pdf2jpg", {
    quality: $id("p2jQuality")?.value,
    scale: $id("p2jScale")?.value
  }, pickedFile ? [pickedFile] : []);
}

// ============================================================
// PICK + PREVIEW
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
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    pageCount = pdfDoc.numPages;
    pickedFile = file;

    $id("wsOptionsBlock").classList.remove("hidden");
    $id("wsProcess").disabled = false;
    renderPreview();
    persistState();
  } catch (e) {
    console.error(e);
    err.textContent = "Couldn't open this PDF. It may be password-protected.";
  }
}

async function renderPreview() {
  const preview = $id("wsPreview");
  preview.innerHTML = `<div class="ws-progress"><div class="ws-progress-bar"><i style="width:0%"></i></div><p class="ws-progress-label">Rendering…</p></div>`;

  try {
    // Show first 6 thumbnails
    const sampleN = Math.min(6, pageCount);
    const sampleUrls = [];
    for (let i = 1; i <= sampleN; i++) {
      const page = await pdfDoc.getPage(i);
      const vp = page.getViewport({ scale: 0.6 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      sampleUrls.push(c.toDataURL("image/jpeg", 0.7));
    }

    preview.innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${esc(pickedFile.name)}</b>
          <span>${pageCount} page${pageCount > 1 ? "s" : ""} · ${formatBytes(pickedFile.size)}</span>
        </div>
      </div>
      <div class="extracted-grid">
        ${sampleUrls
          .map((u, i) => `
          <div class="extracted-card">
            <img src="${u}" alt="Page ${i + 1}">
            <div class="extracted-foot">
              <span>page-${String(i + 1).padStart(3, "0")}.jpg</span>
            </div>
          </div>
        `)
          .join("")}
      </div>
      ${pageCount > sampleN ? `<p class="meta" style="text-align:center">…and ${pageCount - sampleN} more pages</p>` : ""}
    `;
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

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Rendering…`;

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const quality = parseFloat($id("p2jQuality").value);
    const scale = parseFloat($id("p2jScale").value);

    const images = [];
    for (let i = 1; i <= pageCount; i++) {
      const pct = (i / pageCount) * 90;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Rendering page ${i} of ${pageCount}`;

      const page = await pdfDoc.getPage(i);
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
      images.push({
        name: `page-${String(i).padStart(3, "0")}.jpg`,
        blob
      });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Packaging…";

    let outBlob, outName;
    if (images.length === 1) {
      outBlob = images[0].blob;
      outName = images[0].name;
    } else {
      const z = new JSZip();
      images.forEach((img) => z.file(img.name, img.blob));
      outBlob = await z.generateAsync({ type: "blob" });
      outName = `${pickedFile.name.replace(/\.pdf$/i, "")}-images.zip`;
    }

    const url = URL.createObjectURL(outBlob);

    successBar(url, outName, outBlob.size, images.length);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(outName)}</b>
        <span>${images.length} image${images.length > 1 ? "s" : ""} · ${formatBytes(outBlob.size)}</span>
      </div>
      <div class="extracted-grid" style="margin-top:16px">
        ${images.slice(0, 6).map((img) => `
          <div class="extracted-card">
            <img src="${URL.createObjectURL(img.blob)}" alt="${esc(img.name)}">
            <div class="extracted-foot">
              <span>${esc(img.name)}</span>
              <a href="${URL.createObjectURL(img.blob)}" download="${esc(img.name)}" title="Download this image">
                <i class="fa-solid fa-download"></i>
              </a>
            </div>
          </div>
        `).join("")}
      </div>
      ${images.length > 6 ? `<p class="meta" style="text-align:center">…and ${images.length - 6} more images in the ZIP</p>` : ""}
    `;

    toast(`Exported ${images.length} image${images.length > 1 ? "s" : ""}!`);
  } catch (e) {
    console.error(e);
    toast("Export failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-file-image"></i> Export Images`;
  }
}

function successBar(url, filename, size, count) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download ${count > 1 ? "ZIP" : "JPG"}
    </a>
  `;
  $id("wsRename").onclick = () => {
    const box = document.createElement("div");
    box.className = "rename-box";
    box.innerHTML = `
      <div class="box">
        <h3>Rename file</h3>
        <input type="text" id="renameInput" value="${esc(filename.replace(/\.[^.]+$/, ""))}">
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
      const ext = filename.match(/\.[^.]+$/)?.[0] || "";
      let v = input.value.trim() || "output";
      if (!v.endsWith(ext)) v += ext;
      $id("wsDownload").setAttribute("download", v);
      const nameEl = $id("wsResultName");
      if (nameEl) nameEl.textContent = v;
      toast(`Renamed to ${v}`);
      close();
    };
  };
  $id("wsDownload").addEventListener("click", () => clearState("pdf2jpg"));
}

export const pdf2jpgTool = {
  id: "pdf2jpg",
  name: "PDF to Images",
  desc: "Export every page as a JPG. Zipped if more than one.",
  icon: "fa-file-image",
  color: "#dc3545",
  mount
};