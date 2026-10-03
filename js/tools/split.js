// js/tools/split.js
// Split PDF — break into multiple files by page ranges.

import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

const { PDFDocument } = PDFLib;

let pickedFile = null;
let previewPdf = null;
let pageCount = 0;
let mode = "ranges"; // "ranges" | "everyN"

// ============================================================
// MOUNT
// ============================================================
async function mount(root, onExit) {
  pickedFile = null;
  previewPdf = null;
  pageCount = 0;
  mode = "ranges";

  root.innerHTML = `
    <div class="ws-topbar">
      <button class="ws-back" id="wsBack" title="Back to tools">
        <i class="fa-solid fa-arrow-left"></i>
      </button>
      <div class="ws-title">
        <div class="ws-icon" style="color:#e67e22"><i class="fa-solid fa-scissors"></i></div>
        <div>
          <h2>Split PDF</h2>
          <small>Split by custom page ranges or every N pages. Result is a ZIP of PDFs.</small>
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
            <label>Split method</label>
            <div style="display:flex;gap:6px">
              <button class="btn primary" id="tabRanges" style="flex:1;justify-content:center">
                <i class="fa-solid fa-list"></i> Ranges
              </button>
              <button class="btn" id="tabEveryN" style="flex:1;justify-content:center">
                <i class="fa-solid fa-layer-group"></i> Every N
              </button>
            </div>
          </div>

          <div id="paneRanges" class="ws-field">
            <label>Page ranges (one file per range)</label>
            <input type="text" id="spRanges" value="1-3, 4-6, 7-9" placeholder="e.g. 1-3, 4-6, 7-9">
            <small>Comma-separated. Use dashes for ranges.</small>
          </div>

          <div id="paneEveryN" class="ws-field hidden">
            <label>Split every N pages</label>
            <input type="number" id="spEveryN" value="5" min="1">
            <small>Each output file will contain N pages (last may be smaller).</small>
          </div>

          <div class="info-card">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <b>Output format</b>
              <span>You'll get a single ZIP containing one PDF per split part, named part-1.pdf, part-2.pdf, etc.</span>
            </div>
          </div>
        </div>
      </aside>

      <div class="ws-preview" id="wsPreview">
        <div class="ws-empty">
          <i class="fa-solid fa-file-pdf"></i>
          <b>No file yet</b>
          <span>Add a PDF to preview the split layout.</span>
        </div>
      </div>
    </div>

    <div class="ws-actions">
      <div class="ws-actions-left">
        <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
      <div class="ws-actions-right" id="wsActionsRight">
        <button class="btn primary" id="wsProcess" disabled>
          <i class="fa-solid fa-scissors"></i> Split PDF
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

  $id("tabRanges").onclick = () => switchMode("ranges");
  $id("tabEveryN").onclick = () => switchMode("everyN");
  $id("spRanges").addEventListener("input", () => { renderPreview(); persistState(); });
  $id("spEveryN").addEventListener("input", () => { renderPreview(); persistState(); });

  $id("wsProcess").onclick = process;

  try {
    const saved = await loadState("split");
    if (saved) {
      if (saved.opts.mode) mode = saved.opts.mode;
      if (saved.opts.ranges) $id("spRanges").value = saved.opts.ranges;
      if (saved.opts.everyN) $id("spEveryN").value = saved.opts.everyN;
      switchMode(mode);
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
  saveState("split", {
    mode,
    ranges: $id("spRanges")?.value,
    everyN: $id("spEveryN")?.value
  }, pickedFile ? [pickedFile] : []);
}

function switchMode(m) {
  mode = m;
  if (m === "ranges") {
    $id("tabRanges").classList.add("primary");
    $id("tabEveryN").classList.remove("primary");
    $id("paneRanges").classList.remove("hidden");
    $id("paneEveryN").classList.add("hidden");
  } else {
    $id("tabEveryN").classList.add("primary");
    $id("tabRanges").classList.remove("primary");
    $id("paneEveryN").classList.remove("hidden");
    $id("paneRanges").classList.add("hidden");
  }
  renderPreview();
  persistState();
}

// ============================================================
// PICK
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

  let parts = [];
  try {
    if (mode === "ranges") {
      const text = $id("spRanges").value;
      for (const part of String(text).split(",")) {
        const s = part.trim();
        if (!s) continue;
        const pages = parseRange(s, pageCount);
        if (pages.length) parts.push({ label: s, count: pages.length, pages });
      }
    } else {
      const n = Math.max(1, parseInt($id("spEveryN").value) || 1);
      for (let i = 1; i <= pageCount; i += n) {
        const end = Math.min(i + n - 1, pageCount);
        parts.push({ label: `${i}-${end}`, count: end - i + 1, pages: [] });
      }
    }
  } catch (e) {
    console.error(e);
  }

  if (!parts.length) {
    preview.innerHTML = `<div class="ws-empty"><i class="fa-solid fa-scissors"></i><b>Nothing to split</b><span>Enter at least one valid page range or N value.</span></div>`;
    return;
  }

  preview.innerHTML = `
    <div class="preview-file">
      <i class="fa-solid fa-file-pdf"></i>
      <div>
        <b>${esc(pickedFile.name)}</b>
        <span>${pageCount} pages · ${formatBytes(pickedFile.size)}</span>
      </div>
    </div>
    <div style="width:100%;max-width:720px">
      <p class="meta" style="margin-bottom:8px">
        Will produce <b>${parts.length}</b> file${parts.length > 1 ? "s" : ""}
      </p>
      <div class="split-points">
        ${parts.map((p, i) => `
          <div class="split-point">
            <span>part-${i + 1}.pdf</span>
            <b>${p.label} · ${p.count} page${p.count > 1 ? "s" : ""}</b>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function parseRange(str, total) {
  const m = String(str).match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const a = Math.max(1, +m[1]);
    const b = Math.min(total, +m[2]);
    const arr = [];
    if (a <= b) for (let i = a; i <= b; i++) arr.push(i);
    return arr;
  }
  const n = +str;
  if (n >= 1 && n <= total) return [n];
  return [];
}

// ============================================================
// PROCESS
// ============================================================
async function process() {
  if (!pickedFile) return toast("Add a PDF first.");

  const btn = $id("wsProcess");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Splitting…`;

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
    let groups = [];

    if (mode === "ranges") {
      const text = $id("spRanges").value;
      for (const part of String(text).split(",")) {
        const s = part.trim();
        if (!s) continue;
        const pages = parseRange(s, pageCount);
        if (pages.length) groups.push({ label: s, pages });
      }
    } else {
      const n = Math.max(1, parseInt($id("spEveryN").value) || 1);
      for (let i = 1; i <= pageCount; i += n) {
        const end = Math.min(i + n - 1, pageCount);
        const pages = [];
        for (let p = i; p <= end; p++) pages.push(p);
        groups.push({ label: `${i}-${end}`, pages });
      }
    }

    if (!groups.length) throw new Error("No valid ranges.");

    const outputs = [];
    for (let i = 0; i < groups.length; i++) {
      const pct = (i / groups.length) * 90;
      $id("wsProgressFill").style.width = pct + "%";
      $id("wsProgressLabel").textContent = `Building part ${i + 1} of ${groups.length}`;

      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, groups[i].pages.map((n) => n - 1));
      copied.forEach((p) => out.addPage(p));
      const outBytes = await out.save();
      outputs.push({ name: `part-${i + 1}.pdf`, bytes: outBytes });
    }

    $id("wsProgressFill").style.width = "95%";
    $id("wsProgressLabel").textContent = "Zipping…";

    let outBlob, outName;
    if (outputs.length === 1) {
      outBlob = new Blob([outputs[0].bytes], { type: "application/pdf" });
      outName = outputs[0].name;
    } else {
      const z = new JSZip();
      outputs.forEach((o) => z.file(o.name, new Blob([o.bytes], { type: "application/pdf" })));
      outBlob = await z.generateAsync({ type: "blob" });
      outName = `${pickedFile.name.replace(/\.pdf$/i, "")}-split.zip`;
    }

    const url = URL.createObjectURL(outBlob);

    successBar(url, outName, outBlob.size, outputs.length);

    $id("wsProgressFill").style.width = "100%";
    $id("wsProgressLabel").textContent = "Done!";

    preview.innerHTML = `
      <div class="ws-result">
        <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
        <b id="wsResultName">${esc(outName)}</b>
        <span>${outputs.length} file${outputs.length > 1 ? "s" : ""} · ${formatBytes(outBlob.size)}</span>
      </div>
    `;

    toast(`Split into ${outputs.length} file${outputs.length > 1 ? "s" : ""}!`);
  } catch (e) {
    console.error(e);
    toast("Split failed. Try again.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-scissors"></i> Split PDF`;
  }
}

function successBar(url, filename, size, count) {
  const right = $id("wsActionsRight");
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload" href="${url}" download="${esc(filename)}" style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download ${count > 1 ? "ZIP" : "PDF"}
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
  $id("wsDownload").addEventListener("click", () => clearState("split"));
}

export const splitTool = {
  id: "split",
  name: "Split PDF",
  desc: "Split into multiple files by page ranges or every N pages.",
  icon: "fa-scissors",
  color: "#e67e22",
  mount
};