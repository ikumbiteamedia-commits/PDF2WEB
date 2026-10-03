// js/pdf-tools.js
// PDF Tools — coherent, complete, with progress + download for every tool.
// Loaded only by app.html (which also loads app.js).

import { db, storage, auth } from "./firebase.js";
import { ref, uploadBytes, getBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  collection, doc, setDoc, onSnapshot, query, orderBy, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { S } from "./app.js";

const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;
const $ = (i) => document.getElementById(i);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

const toast = (m) => S.toast && S.toast(m);

// ============================================================
// HELPERS
// ============================================================
const load = async (fileOrBytes) => {
  const bytes = fileOrBytes instanceof File
    ? await fileOrBytes.arrayBuffer()
    : fileOrBytes;
  return PDFDocument.load(bytes, { ignoreEncryption: true });
};

const blob = async (pdfDoc) =>
  new Blob([await pdfDoc.save()], { type: "application/pdf" });

const zipBlob = async (files) => {
  const z = new JSZip();
  files.forEach(([name, blob]) => z.file(name, blob));
  return z.generateAsync({ type: "blob" });
};

const formatBytes = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
};

const rangeToList = (str, total) => {
  const out = [];
  for (const part of String(str).split(",")) {
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
};

// ============================================================
// PROGRESS / STATUS UI
// ============================================================
function showProgress(pct, label) {
  const wrap = $("tmProgress");
  const bar = $("tmProgressBar");
  const lbl = $("tmProgressLabel");
  if (!wrap) return;
  wrap.classList.remove("hidden");
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (lbl) lbl.textContent = label || "";
}

function hideProgress() {
  const wrap = $("tmProgress");
  if (wrap) wrap.classList.add("hidden");
}

function resetToolModal() {
  const err = $("tmErr"); if (err) err.textContent = "";
  const out = $("tmOut"); if (out) out.innerHTML = "";
  const src = $("tmSrcPicker"); if (src) src.classList.add("hidden");
  const fa = $("tmFileArea"); if (fa) fa.classList.add("hidden");
  const oa = $("tmOptionsArea"); if (oa) oa.classList.add("hidden");
  const run = $("tmRun"); if (run) run.classList.add("hidden");
  hideProgress();
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================
const T = [
  // ---------- MERGE ----------
  {
    id: "merge",
    name: "Merge PDFs",
    desc: "Combine 2 or more PDFs into a single file. Order is preserved.",
    icon: "fa-object-group",
    color: "#1e6b3a",
    multiple: true,
    minFiles: 2,
    accept: "application/pdf",
    options: [],
    async run(files, opts, onProgress) {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        onProgress((i / files.length) * 90, `Adding "${files[i].name}" (${i + 1}/${files.length})`);
        const src = await load(files[i]);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      onProgress(95, "Saving…");
      return ["merged.pdf", await blob(out)];
    }
  },

  // ---------- SPLIT ----------
  {
    id: "split",
    name: "Split PDF",
    desc: "Break a PDF into smaller files by page ranges.",
    icon: "fa-scissors",
    color: "#e67e22",
    accept: "application/pdf",
    options: [
      { id: "ranges", label: "Page ranges (one file per range)", type: "text", v: "1-3, 4-6" }
    ],
    async run(files, opts, onProgress) {
      const src = await load(files[0]);
      const total = src.getPageCount();
      const ranges = String(opts.ranges).split(",").map(s => s.trim()).filter(Boolean);
      const out = [];
      for (let i = 0; i < ranges.length; i++) {
        onProgress((i / ranges.length) * 90, `Building part ${i + 1}`);
        const pages = rangeToList(ranges[i], total);
        if (!pages.length) continue;
        const doc = await PDFDocument.create();
        const copied = await doc.copyPages(src, pages.map(n => n - 1));
        copied.forEach(p => doc.addPage(p));
        out.push([`part-${i + 1}.pdf`, await blob(doc)]);
      }
      if (!out.length) throw new Error("No valid ranges produced output.");
      if (out.length === 1) return out[0];
      onProgress(95, "Zipping…");
      return ["split.zip", await zipBlob(out)];
    }
  },

  // ---------- COMPRESS ----------
  {
    id: "compress",
    name: "Compress PDF",
    desc: "Reduce file size by re-rendering pages as images. Text becomes non-selectable.",
    icon: "fa-compress",
    color: "#1a6dff",
    accept: "application/pdf",
    options: [
      { id: "q", label: "Quality", type: "select", v: "0.75",
        options: [["Smaller (recommended)", "0.6"], ["Balanced", "0.75"], ["Better quality", "0.9"]] }
    ],
    async run(files, opts, onProgress) {
      const file = files[0];
      const p = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const total = p.numPages;
      const out = await PDFDocument.create();
      const scale = 1.4;
      for (let i = 1; i <= total; i++) {
        onProgress((i / total) * 90, `Rendering page ${i} of ${total}`);
        const page = await p.getPage(i);
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        const jpgBlob = await new Promise(r => c.toBlob(r, "image/jpeg", +opts.q));
        const jpgBytes = await jpgBlob.arrayBuffer();
        const img = await out.embedJpg(jpgBytes);
        const pg = out.addPage([vp.width / scale, vp.height / scale]);
        pg.drawImage(img, { x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight() });
      }
      onProgress(95, "Saving…");
      const b = await blob(out);
      if (b.size >= file.size) {
        throw new Error(
          `This PDF is already ${formatBytes(file.size)}. Compressing would make it larger.`
        );
      }
      return ["compressed.pdf", b];
    }
  },

  // ---------- ROTATE ----------
  {
    id: "rotate",
    name: "Rotate PDF",
    desc: "Rotate all pages of a PDF.",
    icon: "fa-rotate-right",
    color: "#1e6b3a",
    accept: "application/pdf",
    options: [
      { id: "a", label: "Rotation", type: "select", v: "90",
        options: [["90° clockwise", "90"], ["180°", "180"], ["90° counter-clockwise", "270"]] }
    ],
    async run(files, opts, onProgress) {
      onProgress(30, "Loading…");
      const d = await load(files[0]);
      onProgress(60, "Rotating pages…");
      d.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + +opts.a) % 360)));
      onProgress(90, "Saving…");
      return ["rotated.pdf", await blob(d)];
    }
  },

  // ---------- WATERMARK ----------
  {
    id: "watermark",
    name: "Add Watermark",
    desc: "Stamp text across every page of a PDF.",
    icon: "fa-droplet",
    color: "#1a6dff",
    accept: "application/pdf",
    options: [
      { id: "t", label: "Watermark text", type: "text", v: "CONFIDENTIAL" },
      { id: "op", label: "Opacity (0.1 – 1)", type: "text", v: "0.25" },
      { id: "sz", label: "Font size (auto if blank)", type: "text", v: "" }
    ],
    async run(files, opts, onProgress) {
      onProgress(20, "Loading…");
      const d = await load(files[0]);
      const font = await d.embedFont(StandardFonts.HelveticaBold);
      const pages = d.getPages();
      for (let i = 0; i < pages.length; i++) {
        onProgress(20 + (i / pages.length) * 70, `Watermarking page ${i + 1} of ${pages.length}`);
        const p = pages[i];
        const { width: w, height: h } = p.getSize();
        const size = +opts.sz || Math.min(w, h) / (Math.max(opts.t.length, 6) / 2.2);
        p.drawText(opts.t, {
          x: w * 0.1, y: h * 0.35,
          size, font,
          rotate: degrees(40),
          opacity: Math.min(1, Math.max(0.05, +opts.op || 0.25)),
          color: rgb(0.4, 0.4, 0.4)
        });
      }
      onProgress(95, "Saving…");
      return ["watermarked.pdf", await blob(d)];
    }
  },

  // ---------- DELETE PAGES ----------
  {
    id: "delete-pages",
    name: "Delete Pages",
    desc: "Remove specific pages from a PDF.",
    icon: "fa-trash-can",
    color: "#dc3545",
    accept: "application/pdf",
    options: [
      { id: "p", label: "Pages to delete (e.g. 1, 3-5, 10)", type: "text", v: "" }
    ],
    async run(files, opts, onProgress) {
      onProgress(20, "Loading…");
      const src = await load(files[0]);
      const total = src.getPageCount();
      const toDelete = new Set(rangeToList(opts.p, total));
      if (!toDelete.size) throw new Error("Enter at least one page number to delete.");
      const keep = [];
      for (let i = 1; i <= total; i++) if (!toDelete.has(i)) keep.push(i - 1);
      if (!keep.length) throw new Error("Can't delete every page.");
      onProgress(60, `Keeping ${keep.length} of ${total} pages`);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, keep);
      copied.forEach(p => out.addPage(p));
      onProgress(95, "Saving…");
      return ["deleted-pages.pdf", await blob(out)];
    }
  },

  // ---------- EXTRACT PAGES ----------
  {
    id: "extract-pages",
    name: "Extract Pages",
    desc: "Keep only specific pages, discard the rest.",
    icon: "fa-file-export",
    color: "#1e6b3a",
    accept: "application/pdf",
    options: [
      { id: "p", label: "Pages to keep (e.g. 1-5, 10, 12-15)", type: "text", v: "" }
    ],
    async run(files, opts, onProgress) {
      onProgress(20, "Loading…");
      const src = await load(files[0]);
      const total = src.getPageCount();
      const keep = rangeToList(opts.p, total);
      if (!keep.length) throw new Error("Enter at least one page or range to keep.");
      onProgress(60, `Extracting ${keep.length} pages`);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, keep.map(n => n - 1));
      copied.forEach(p => out.addPage(p));
      onProgress(95, "Saving…");
      return ["extracted.pdf", await blob(out)];
    }
  },

  // ---------- SIGN ----------
  {
    id: "sign",
    name: "Sign PDF",
    desc: "Draw your signature and place it on a page.",
    icon: "fa-signature",
    color: "#1e6b3a",
    accept: "application/pdf",
    options: [
      { id: "p", label: "Page number", type: "text", v: "1" },
      { id: "pos", label: "Position on the page", type: "select", v: "r",
        options: [["Bottom right", "r"], ["Bottom left", "l"], ["Bottom centre", "c"]] }
    ],
    draw: true,
    async run(files, opts, onProgress) {
      if (!opts.sig) throw new Error("Draw your signature in the box above.");
      onProgress(20, "Loading…");
      const d = await load(files[0]);
      const total = d.getPageCount();
      const pNum = Math.min(total, Math.max(1, +opts.p || 1));
      const p = d.getPage(pNum - 1);
      const img = await d.embedPng(opts.sig);
      const { width: w } = p.getSize();
      const sw = w * 0.28;
      const sh = (sw * img.height) / img.width;
      const x = opts.pos === "l" ? w * 0.08
              : opts.pos === "c" ? (w - sw) / 2
              : w * 0.92 - sw;
      onProgress(70, "Placing signature…");
      p.drawImage(img, { x, y: 40, width: sw, height: sh });
      onProgress(95, "Saving…");
      return ["signed.pdf", await blob(d)];
    }
  },

  // ---------- PDF → JPG ----------
  {
    id: "pdf2jpg",
    name: "PDF to Images",
    desc: "Export every page as a JPG (zipped if more than one).",
    icon: "fa-file-image",
    color: "#dc3545",
    accept: "application/pdf",
    options: [],
    async run(files, opts, onProgress) {
      const p = await pdfjsLib.getDocument({ data: await files[0].arrayBuffer() }).promise;
      const total = p.numPages;
      const out = [];
      for (let i = 1; i <= total; i++) {
        onProgress((i / total) * 90, `Rendering page ${i} of ${total}`);
        const page = await p.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement("canvas");
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
        out.push([`page-${String(i).padStart(3, "0")}.jpg`, b]);
      }
      onProgress(95, "Packaging…");
      if (out.length === 1) return out[0];
      return ["pages.zip", await zipBlob(out)];
    }
  },

  // ---------- JPG → PDF ----------
  {
    id: "jpg2pdf",
    name: "Images to PDF",
    desc: "Combine images (JPG, PNG) into a single PDF.",
    icon: "fa-file-pdf",
    color: "#dc3545",
    accept: "image/*",
    multiple: true,
    minFiles: 1,
    options: [],
    async run(files, opts, onProgress) {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        onProgress((i / files.length) * 90, `Adding "${files[i].name}" (${i + 1}/${files.length})`);
        const bm = await createImageBitmap(files[i]);
        const c = document.createElement("canvas");
        c.width = bm.width; c.height = bm.height;
        c.getContext("2d").drawImage(bm, 0, 0);
        const jpegBytes = await (await new Promise(r => c.toBlob(r, "image/jpeg", 0.92))).arrayBuffer();
        const img = await out.embedJpg(jpegBytes);
        const pg = out.addPage([img.width, img.height]);
        pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      onProgress(95, "Saving…");
      return ["images.pdf", await blob(out)];
    }
  },

  // ---------- SERVER TOOLS ----------
  {
    id: "pdf2word",
    name: "PDF to Word",
    desc: "Server conversion (text-based). Requires Cloud Functions.",
    icon: "fa-file-word",
    color: "#1a6dff",
    accept: "application/pdf",
    server: true,
    options: []
  },
  {
    id: "pdf2excel",
    name: "PDF to Excel",
    desc: "Server conversion. Requires Cloud Functions.",
    icon: "fa-file-excel",
    color: "#1e6b3a",
    accept: "application/pdf",
    server: true,
    options: []
  },
  {
    id: "pdf2ppt",
    name: "PDF to PowerPoint",
    desc: "Server conversion. Requires Cloud Functions.",
    icon: "fa-file-powerpoint",
    color: "#e67e22",
    accept: "application/pdf",
    server: true,
    options: []
  }
];

// ============================================================
// RENDER TOOL GRID
// ============================================================
$("toolGrid").innerHTML = T.map(
  (t) => `<div class="card tool-card" data-tool="${t.id}" style="text-align:center">
    <div class="tool-icon" style="color:${t.color}"><i class="fa-solid ${t.icon}"></i></div>
    <h3>${t.name}</h3>
    <p class="meta" style="margin:6px 0 0">${t.desc}</p>
  </div>`
).join("");

// ============================================================
// STATE
// ============================================================
let currentTool = null;
let pickedFiles = [];

// ============================================================
// OPEN TOOL
// ============================================================
function openTool(id) {
  currentTool = T.find((t) => t.id === id);
  pickedFiles = [];

  resetToolModal();
  $("tmTitle").textContent = currentTool.name;
  $("tmNote").textContent = currentTool.desc;

  // Build source picker
  $("tmSrcPicker").innerHTML = `
    <p class="meta" style="margin-bottom:12px">Where should we get the file${currentTool.multiple ? "s" : ""} from?</p>
    <div class="src-options">
      <button class="src-btn" data-src="device">
        <i class="fa-solid fa-laptop"></i>
        <div><b>Upload from this device</b><small>Pick a PDF from your computer or phone</small></div>
      </button>
      <button class="src-btn" data-src="library">
        <i class="fa-solid fa-book"></i>
        <div><b>From my PDF2WEB library</b><small>Use a PDF you already uploaded</small></div>
      </button>
    </div>
  `;
  $("tmSrcPicker").classList.remove("hidden");
  $("toolModal").classList.remove("hidden");
}

// ============================================================
// PICK SOURCE
// ============================================================
document.addEventListener("click", async (e) => {
  const toolCard = e.target.closest("[data-tool]");
  if (toolCard) return openTool(toolCard.dataset.tool);

  const srcBtn = e.target.closest("[data-src]");
  if (srcBtn && currentTool) return pickSource(srcBtn.dataset.src);

  if (e.target.closest("#tmRun")) runTool();

  if (e.target.closest("#tmClose")) {
    $("toolModal").classList.add("hidden");
  }

  const dlBtn = e.target.closest("[data-dl]");
  if (dlBtn) {
    try {
      const u = URL.createObjectURL(new Blob([await getBytes(ref(storage, dlBtn.dataset.path))]));
      const a = document.createElement("a");
      a.href = u;
      a.download = dlBtn.dataset.n;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    } catch (er) {
      console.error(er);
      toast("We couldn't download this file.");
    }
  }
});

// ============================================================
// SOURCE PICKER
// ============================================================
async function pickSource(src) {
  pickedFiles = [];
  $("tmSrcPicker").classList.add("hidden");
  $("tmFileArea").classList.remove("hidden");

  if (src === "device") {
    $("tmFileArea").innerHTML = `
      <label class="meta">Choose file${currentTool.multiple ? "s" : ""} from your device</label>
      <input type="file" id="tmFile" class="field" accept="${currentTool.accept}" ${currentTool.multiple ? "multiple" : ""}>
      <p class="meta" id="tmFileList"></p>
    `;
    const inp = $("tmFile");
    inp.addEventListener("change", () => {
      pickedFiles = [...inp.files];
      updateFileList();
    });
  } else {
    $("tmFileArea").innerHTML = `
      <label class="meta">Choose a PDF from your library</label>
      <select id="tmLibSel" class="field">
        <option value="">Loading…</option>
      </select>
      <p class="meta" id="tmFileList"></p>
    `;
    try {
      const docs = [];
      const snap = await getDocs(query(collection(db, "users", auth.currentUser.uid, "documents"), orderBy("createdAt", "desc")));
      snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));

      const sel = $("tmLibSel");
      if (!docs.length) {
        sel.innerHTML = `<option value="">No files in library</option>`;
        sel.disabled = true;
        return;
      }
      sel.innerHTML = `<option value="">— Pick a document —</option>` +
        docs.map((d) => `<option value="${d.id}">${esc(d.displayName || "Untitled")}</option>`).join("");

      sel.addEventListener("change", async () => {
        const id = sel.value;
        if (!id) return;
        const d = docs.find((x) => x.id === id);
        try {
          const url = await getDownloadURL(ref(storage, d.storagePath));
          const resp = await fetch(url, { mode: "cors", credentials: "omit" });
          const blobOut = await resp.blob();
          const file = new File([blobOut], (d.displayName || "document") + ".pdf", { type: "application/pdf" });
          pickedFiles = [file];
          updateFileList();
        } catch (er) {
          console.error(er);
          toast("Could not load that file.");
        }
      });
    } catch (er) {
      console.error(er);
      $("tmFileArea").innerHTML = `<p class="err">Could not load your library.</p>`;
    }
  }
}

function updateFileList() {
  const out = $("tmFileList");
  if (!out) return;
  if (currentTool.multiple) {
    out.className = "meta";
    out.innerHTML = pickedFiles.length
      ? pickedFiles.map(f => `• ${esc(f.name)} (${formatBytes(f.size)})`).join("<br>")
      : "No files selected yet.";
  } else if (pickedFiles[0]) {
    out.className = "meta";
    out.innerHTML = `Selected: <b>${esc(pickedFiles[0].name)}</b> (${formatBytes(pickedFiles[0].size)})`;
  } else {
    out.className = "meta";
    out.textContent = "";
  }

  // Once files are picked, show options + Run button
  if (pickedFiles.length) {
    showOptions();
  } else {
    $("tmOptionsArea").classList.add("hidden");
    $("tmRun").classList.add("hidden");
  }
}

// ============================================================
// SHOW OPTIONS
// ============================================================
function showOptions() {
  const area = $("tmOptionsArea");
  const opts = currentTool.options || [];

  let html = "";

  // Sign tool: signature pad
  if (currentTool.draw) {
    html += `
      <label class="meta">Draw your signature below</label>
      <canvas id="sigPad" width="600" height="180"
        style="width:100%;border:2px dashed var(--border-strong);border-radius:12px;background:#fff"></canvas>
      <button type="button" class="btn" id="sigClear" style="margin-top:6px">
        <i class="fa-solid fa-eraser"></i> Clear signature
      </button>
    `;
  }

  for (const o of opts) {
    html += `<label class="meta">${o.label}</label>`;
    if (o.type === "select") {
      html += `<select class="field" data-opt="${o.id}">${o.options.map(
        ([label, val]) => `<option value="${val}"${val === o.v ? " selected" : ""}>${label}</option>`
      ).join("")}</select>`;
    } else {
      html += `<input class="field" data-opt="${o.id}" value="${esc(o.v || "")}" placeholder="${esc(o.label)}">`;
    }
  }

  area.innerHTML = html;
  area.classList.remove("hidden");
  $("tmRun").classList.remove("hidden");
  $("tmRun").disabled = false;
  $("tmRun").innerHTML = `<i class="fa-solid fa-play"></i> Process`;

  if (currentTool.draw) {
    setupSignaturePad();
    $("sigClear").addEventListener("click", () => {
      const c = $("sigPad");
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
      delete c.dataset.drawn;
    });
  }
}

// ============================================================
// SIGNATURE PAD
// ============================================================
function setupSignaturePad() {
  const c = $("sigPad");
  const x = c.getContext("2d");
  x.lineWidth = 3;
  x.lineCap = "round";
  x.strokeStyle = "#111";
  let drawing = false;
  c.style.touchAction = "none";

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
// RUN TOOL
// ============================================================
async function runTool() {
  if (!currentTool || !pickedFiles.length) return;

  // Validate minFiles
  if (currentTool.minFiles && pickedFiles.length < currentTool.minFiles) {
    $("tmErr").textContent = `Please choose at least ${currentTool.minFiles} files.`;
    return;
  }

  // Gather option values
  const opts = {};
  document.querySelectorAll("[data-opt]").forEach((el) => (opts[el.dataset.opt] = el.value));

  // Signature
  if (currentTool.draw) {
    const c = $("sigPad");
    if (c && c.dataset.drawn) opts.sig = c.toDataURL("image/png");
  }

  $("tmErr").textContent = "";
  $("tmOut").innerHTML = "";
  $("tmRun").disabled = true;
  $("tmRun").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing…`;
  showProgress(0, "Starting…");

  const onProgress = (pct, label) => showProgress(pct, label);

  try {
    if (currentTool.server) {
      // Server conversion
      const file = pickedFiles[0];
      const u = auth.currentUser.uid;
      const id = doc(collection(db, "users", u, "conversions")).id;
      const path = `users/${u}/conversions/${id}/input.pdf`;
      const dref = doc(db, "users", u, "conversions", id);

      showProgress(15, "Uploading to secure server…");
      await uploadBytes(ref(storage, path), file, { contentType: "application/pdf" });

      showProgress(35, "Queued for processing…");
      await setDoc(dref, {
        tool: currentTool.id,
        inputPath: path,
        name: file.name,
        status: "queued",
        createdAt: serverTimestamp()
      });

      const finalDoc = await new Promise((res, rej) => {
        const un = onSnapshot(dref, (s) => {
          const x = s.data();
          if (x.status === "processing") showProgress(65, "Processing on the server…");
          if (x.status === "completed") { un(); res(x); }
          if (x.status === "failed") { un(); rej(new Error(x.error || "Server error")); }
        });
      });

      showProgress(90, "Fetching result…");
      const bytes = await getBytes(ref(storage, finalDoc.outputPath));
      showResult(finalDoc.outName || "result", new Blob([bytes]));
    } else {
      // Client-side tool
      const [name, blobOut] = await currentTool.run(pickedFiles, opts, onProgress);
      showProgress(100, "Done");
      showResult(name, blobOut);
    }
  } catch (err) {
    console.error(err);
    hideProgress();
    $("tmErr").textContent = err.message || "We couldn't process this file. Please try again.";
    $("tmRun").disabled = false;
    $("tmRun").innerHTML = `<i class="fa-solid fa-play"></i> Try again`;
  }
}

// ============================================================
// SHOW RESULT
// ============================================================
function showResult(fileName, blobOut) {
  hideProgress();
  const size = formatBytes(blobOut.size);
  const url = URL.createObjectURL(blobOut);
  $("tmOut").innerHTML = `
    <div class="tool-result">
      <div class="tool-result-icon"><i class="fa-solid fa-circle-check"></i></div>
      <div class="tool-result-body">
        <b>${esc(fileName)}</b>
        <span class="meta">${size} · ready to download</span>
      </div>
      <a class="btn primary" href="${url}" download="${esc(fileName)}">
        <i class="fa-solid fa-download"></i> Download
      </a>
    </div>
    <button class="btn" id="tmAnother" style="margin-top:10px;width:100%;justify-content:center">
      <i class="fa-solid fa-plus"></i> Process another file
    </button>
  `;
  $("tmRun").classList.add("hidden");
  setTimeout(() => {
    const a = document.querySelector("#tmOut a[download]");
    if (a) a.click();
  }, 300);

  $("tmAnother").addEventListener("click", () => {
    URL.revokeObjectURL(url);
    if (currentTool) openTool(currentTool.id);
  });
}

// ============================================================
// CONVERSION HISTORY
// ============================================================
let stopConv = null;
document.addEventListener("aafa:render", () => {
  if (!S.U) {
    stopConv?.();
    stopConv = null;
    return;
  }
  if (!stopConv)
    stopConv = onSnapshot(
      query(collection(db, "users", S.U.uid, "conversions"), orderBy("createdAt", "desc")),
      (s) => {
        const list = $("convList");
        if (!list) return;
        list.innerHTML = s.docs.length
          ? s.docs
              .map((d) => {
                const x = d.data();
                const name = T.find(t => t.id === x.tool)?.name || x.tool;
                return `<div class="card" style="cursor:default;margin-bottom:8px">
                  <b>${esc(name)}</b>
                  <span class="meta">${esc(x.name)} · ${x.status}</span>
                  ${x.status === "completed"
                    ? `<button class="btn" data-dl="${d.id}" data-path="${x.outputPath}" data-n="${esc(x.outName)}">Download</button>`
                    : ""}
                </div>`;
              })
              .join("")
          : '<p class="meta">No conversions yet.</p>';
      },
      console.error
    );
});