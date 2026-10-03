// js/tools/jpg2pdf.js
// Images → PDF — combine JPG/PNG images into a single PDF.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument } = PDFLib;

let pickedImages = [];    // { file, dataUrl }
let dragSrcIdx = null;

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedImages = [];

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#dc3545"><i class="fa-solid fa-file-pdf"></i></div>
        <div>
          <h2>Images to PDF</h2>
          <small>Combine JPG or PNG images into one PDF. Drag to reorder.</small>
        </div>
      </div>
    </div>

    <div class="ws-body">
      <aside class="ws-controls">
        <div class="ws-upload" id="wsUpload">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <b>Drop images here</b>
          <span>JPG or PNG · multiple allowed</span>
          <button class="btn primary" id="wsChoose">
            <i class="fa-solid fa-folder-open"></i> Choose Images
          </button>
          <input type="file" id="wsInput" accept="image/*" multiple hidden>
        </div>

        <div id="wsError" class="err"></div>

        <div id="wsOptionsBlock" class="hidden" style="display:flex;flex-direction:column;gap:14px">
          <div class="ws-field">
            <label>Page size</label>
            <select id="j2pSize">
              <option value="fit" selected>Fit each image (recommended)</option>
              <option value="a4">A4 portrait</option>
              <option value="letter">Letter portrait</option>
            </select>
          </div>

          <div class="ws-field">
            <label>Margin</label>
            <select id="j2pMargin">
              <option value="0" selected>None</option>
              <option value="20">Small (20pt)</option>
              <option value="40">Medium (40pt)</option>
            </select>
          </div>

          <div class="info-card">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>Order matters</b>
              <span>Drag images on the right to reorder before generating the PDF.</span>
            </div>
          </div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-images"></i>
          <b>No images yet</b>
          <span>Add JPG or PNG images to preview them here.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-file-pdf"></i> Create PDF
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
    const files = [...e.target.files];
    if (files.length) addImages(files);
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
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
    if (files.length) addImages(files);
    else toast("Please drop JPG or PNG images.");
  });

  $id("wsProcess").onclick = process;

  try {
    const saved = await loadState("jpg2pdf");
    if (saved) {
      if (saved.opts.size) $id("j2pSize").value = saved.opts.size;
      if (saved.opts.margin) $id("j2pMargin").value = saved.opts.margin;
      if (saved.files && saved.files.length) {
        await addImages(saved.files);
        toast("Restored your previous session");
      }
    }
  } catch (e) { console.warn(e); }
}

// ============================================================
// PERSIST
// ============================================================
function persistState() {
  saveState("jpg2pdf", {
    size: $id("j2pSize")?.value,
    margin: $id("j2pMargin")?.value
  }, pickedImages.map((i) => i.file));
}

// ============================================================
// ADD IMAGES
// ============================================================
async function addImages(files) {
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    });
    pickedImages.push({ file: f, dataUrl });
  }
  renderImageGrid();
  updateProcessState();
  persistState();
}

// ============================================================
// RENDER IMAGE GRID
// ============================================================
function renderImageGrid() {
  const preview = $id("wsPreview");
  if (!pickedImages.length) {
    preview.innerHTML = `
      <div class="ws-empty">
        <i class="fa-solid fa-images"></i>
        <b>No images yet</b>
        <span>Add JPG or PNG images to preview them here.</span>
      </div>
    `;
    return;
  }

  preview.innerHTML = `<div class="image-grid" id="imageGrid"></div>`;
  const grid = $id("imageGrid");

  pickedImages.forEach((img, idx) => {
    const card = document.createElement("div");
    card.className = "image-card";
    card.draggable = true;
    card.dataset.idx = idx;
    card.innerHTML = `
      <img src="${img.dataUrl}" alt="${esc(img.file.name)}">
      <b>${idx + 1}. ${esc(img.file.name)}</b>
      <button class="image-remove" data-remove="${idx}" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    grid.appendChild(card);
  });

  wireReorder(grid);
}

function wireReorder(grid) {
  grid.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".image-card");
    if (!card) return;
    dragSrcIdx = +card.dataset.idx;
  });
  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  grid.addEventListener("drop", (e) => {
    e.preventDefault();
    const card = e.target.closest(".image-card");
    if (!card || dragSrcIdx === null) return;
    const overIdx = +card.dataset.idx;
    if (overIdx === dragSrcIdx) return;
    const [moved] = pickedImages.splice(dragSrcIdx, 1);
    pickedImages.splice(overIdx, 0, moved);
    dragSrcIdx = null;
    renderImageGrid();
    persistState();
  });
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    pickedImages.splice(+btn.dataset.remove, 1);
    renderImageGrid();
    updateProcessState();
    persistState();
  });
}

function updateProcessState() {
  const btn = $id("wsProcess");
  if (!pickedImages.length) { btn.disabled = true; return; }
  btn.disabled = false;
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedImages.length) return toast("Add at least one image.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Building PDF…`;

  const preview = $id("wsPreview");
  preview.innerHTML = `
    <div class="ws-progress">
      <div class="ws-progress-bar"><i id="wsProgressFill" style="width:0%"></i></div>
      <p class="ws-progress-label" id="wsProgressLabel">Starting…</p>
    </div>
  `;

  try {
    const sizeMode = $id("j2pSize").value;
    const margin = parseInt($id("j2pMargin").value) || 0;
    const doc = await PDFDocument.create();
    const total = pickedImages.length;

    for (let i = 0; i < total; i++) {
      const pct = (i / total) * 90;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Adding image ${i + 1} of ${total}`;

      const img = pickedImages[i];
      const arrBuf = await img.file.arrayBuffer();

      let embedded, w, h;
      if (/png/i.test(img.file.type)) {
        embedded = await doc.embedPng(arrBuf);
      } else {
        embedded = await doc.embedJpg(arrBuf);
      }
      w = embedded.width;
      h = embedded.height;

      let pageW, pageH, drawX, drawY, drawW, drawH;
      if (sizeMode === "fit") {
        pageW = w + margin * 2;
        pageH = h + margin * 2;
        drawX = margin;
        drawY = margin;
        drawW = w;
        drawH = h;
      } else {
        const [W, H] = sizeMode === "a4" ? [595.28, 841.89] : [612, 792];
        pageW = W;
        pageH = H;
        const availW = W - margin * 2;
        const availH = H - margin * 2;
        const scale = Math.min(availW / w, availH / h);
        drawW = w * scale;
        drawH = h * scale;
        drawX = (W - drawW) / 2;
        drawY = (H - drawH) / 2;
      }

      const page = doc.addPage([pageW, pageH]);
      page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Saving…";

    const out = await doc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const filename = "images.pdf";

    successBar(url, filename, blob.size, total);

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
        <span>${total} images · ${formatBytes(blob.size)}</span>
      </div>
      <div class="preview-canvas" style="margin-top:16px"></div>
    `;
    preview.querySelector(".preview-canvas").appendChild(c);

    toast("PDF ready! Click Download.");
  } catch (e) {
    console.error(e);
    toast("Conversion failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Create PDF`;
  }
}

function successBar(url, filename, size, count) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download (${count} pages)
    </a>
  `;
  $id("wsRename").onclick = () => {
    const box = document.createElement("div");
    box.className = "rename-box";
    box.innerHTML = `
      <div class="box">
        <h3>Rename file</h3>
        <input type="text" id="renameInput" value="images">
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
      let v = input.value.trim() || "images";
      if (!/\.pdf$/i.test(v)) v += ".pdf";
      $id("wsDownload").setAttribute("download", v);
      const nameEl = $id("wsResultName");
      if (nameEl) nameEl.textContent = v;
      toast(`Renamed to ${v}`);
      close();
    };
  };
  $id("wsDownload").addEventListener("click", () => clearState("jpg2pdf"));
}

export const jpg2pdfTool = {
  id: "jpg2pdf",
  name: "Images to PDF",
  desc: "Combine JPG or PNG images into one PDF.",
  icon: "fa-file-pdf",
  color: "#dc3545",
  mount
};