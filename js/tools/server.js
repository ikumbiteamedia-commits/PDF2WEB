// js/tools/server.js
// Server-side conversions: PDF → Word / Excel / PowerPoint.
// Uses Cloud Functions if deployed. Gracefully handles missing backend.

import { auth, db, storage } from "../firebase.js";
import { ref, uploadBytes, getBytes } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  collection, doc, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $id, esc, formatBytes, toast } from "./index.js";
import { saveState, loadState, clearState } from "./storage.js";

// ============================================================
// TOOL FACTORY
// ============================================================
function makeServerTool({ id, name, desc, icon, color, outputExt, outputLabel }) {
  let pickedFile = null;
  let unsubscribe = null;

  async function mount(root, onExit) {
    pickedFile = null;
    unsubscribe?.();
    unsubscribe = null;

    root.innerHTML = `
      <div class="ws-topbar">
        <button class="ws-back" id="wsBack" title="Back to tools">
          <i class="fa-solid fa-arrow-left"></i>
        </button>
        <div class="ws-title">
          <div class="ws-icon" style="color:${color}"><i class="fa-solid ${icon}"></i></div>
          <div>
            <h2>${name}</h2>
            <small>${desc}</small>
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
              <label>Output format</label>
              <div class="split-point">
                <span>Target</span>
                <b>.${outputExt} — ${outputLabel}</b>
              </div>
            </div>

            <div class="info-card">
              <i class="fa-solid fa-circle-info"></i>
              <div>
                <b>Server processing</b>
                <span>The file is uploaded, converted by our backend, then returned. Nothing is stored permanently.</span>
              </div>
            </div>

            <div class="info-card" style="background:#fff4e6;border-color:#ffd9a8">
              <i class="fa-solid fa-triangle-exclamation" style="color:#e67e22"></i>
              <div>
                <b>Text-only conversion</b>
                <span>Layout, images, and formatting are not preserved. Best for editable content, not pixel-perfect copies.</span>
              </div>
            </div>
          </div>
        </aside>

        <div class="ws-preview" id="wsPreview">
          <div class="ws-empty">
            <i class="fa-solid fa-file-pdf"></i>
            <b>No file yet</b>
            <span>Add a PDF to start the conversion.</span>
          </div>
        </div>
      </div>

      <div class="ws-actions">
        <div class="ws-actions-left">
          <button class="btn" id="wsCancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
        </div>
        <div class="ws-actions-right" id="wsActionsRight">
          <button class="btn primary" id="wsProcess" disabled>
            <i class="fa-solid ${icon}"></i> Convert to ${outputExt.toUpperCase()}
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
      const saved = await loadState(id);
      if (saved && saved.files && saved.files.length) {
        await pickFile(saved.files[0]);
        toast("Restored your previous session");
      }
    } catch (e) { console.warn(e); }
  }

  function persistState() {
    saveState(id, {}, pickedFile ? [pickedFile] : []);
  }

  async function pickFile(file) {
    const err = $id("wsError");
    err.textContent = "";
    if (!/pdf$/i.test(file.type || file.name)) {
      err.textContent = "Only PDF files are supported.";
      return;
    }
    pickedFile = file;
    $id("wsOptionsBlock").classList.remove("hidden");
    $id("wsProcess").disabled = false;

    $id("wsPreview").innerHTML = `
      <div class="preview-file">
        <i class="fa-solid fa-file-pdf"></i>
        <div>
          <b>${esc(file.name)}</b>
          <span>${formatBytes(file.size)} · ready to upload</span>
        </div>
      </div>
      <div class="server-status">
        <div style="font-size:40px;color:var(--primary);margin-bottom:12px">
          <i class="fa-solid ${icon}"></i>
        </div>
        <b>Click "Convert to ${outputExt.toUpperCase()}" to start</b>
        <span>The file will be uploaded to our secure server for processing</span>
      </div>
    `;
    persistState();
  }

  async function process() {
    if (!pickedFile) return toast("Add a PDF first.");

    const btn = $id("wsProcess");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading…`;

    const preview = $id("wsPreview");
    preview.innerHTML = `
      <div class="server-status">
        <div class="spin"></div>
        <b>Uploading your PDF…</b>
        <span>Please wait while we prepare the file</span>
      </div>
    `;

    try {
      const uid = auth.currentUser.uid;
      const path = `users/${uid}/conversions/${Date.now()}_${pickedFile.name.replace(/[^\w.-]+/g, "_")}/input.pdf`;

      // 1. Upload to Storage
      await uploadBytes(ref(storage, path), pickedFile, { contentType: "application/pdf" });

      preview.innerHTML = `
        <div class="server-status">
          <div class="spin"></div>
          <b>Queued for conversion…</b>
          <span id="serverStatusMsg">Creating job…</span>
        </div>
      `;

      // 2. Create a job document using addDoc (always creates, never conflicts)
      const colRef = collection(db, "users", uid, "conversions");
      const jobRef = await addDoc(colRef, {
        tool: id,
        inputPath: path,
        name: pickedFile.name,
        status: "queued",
        createdAt: serverTimestamp()
      });

      // 3. Wait for the Cloud Function to update it (with 45-second timeout)
      const finalDoc = await new Promise((res, rej) => {
        const timeout = setTimeout(() => {
          unsubscribe?.();
          rej(new Error("Server took too long. Make sure Cloud Functions are deployed (firebase deploy --only functions)."));
        }, 45000);

        unsubscribe = onSnapshot(jobRef, (s) => {
          const x = s.data();
          const msgEl = $id("serverStatusMsg");
          if (msgEl) msgEl.textContent = "Status: " + x.status;
          if (x.status === "completed") {
            clearTimeout(timeout);
            unsubscribe();
            unsubscribe = null;
            res(x);
          }
          if (x.status === "failed") {
            clearTimeout(timeout);
            unsubscribe();
            unsubscribe = null;
            rej(new Error(x.error || "Server error"));
          }
        }, (err) => {
          clearTimeout(timeout);
          unsubscribe?.();
          unsubscribe = null;
          rej(err);
        });
      });

      preview.innerHTML = `
        <div class="server-status">
          <div class="spin"></div>
          <b>Fetching result…</b>
          <span>Almost there</span>
        </div>
      `;

      // 4. Download the converted file
      const bytes = await getBytes(ref(storage, finalDoc.outputPath));
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const filename = finalDoc.outName || `${pickedFile.name.replace(/\.pdf$/i, "")}.${outputExt}`;

      successBar(url, filename, blob.size);

      preview.innerHTML = `
        <div class="ws-result">
          <div class="icon"><i class="fa-solid fa-circle-check"></i></div>
          <b id="wsResultName">${esc(filename)}</b>
          <span>${formatBytes(blob.size)} · ready</span>
        </div>
        <div class="info-card" style="margin-top:16px;max-width:720px">
          <i class="fa-solid fa-circle-info"></i>
          <div>
            <b>Note about conversion</b>
            <span>Text-only conversion. Complex layouts and images may not fully preserve.</span>
          </div>
        </div>
      `;

      toast("Converted! Click Download.");
    } catch (e) {
      console.error(e);
      const msg = e?.message || "Please try again.";

      // Show a helpful message about deployment if the failure looks like permissions or timeout
      let friendly = msg;
      if (/permission/i.test(msg)) {
        friendly = "Firestore rules don't allow this. Make sure your rules are published.";
      } else if (/too long|failed-precondition/i.test(msg)) {
        friendly = "Cloud Functions are not responding. Deploy them first: firebase deploy --only functions";
      }

      toast("Conversion failed: " + friendly);
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid ${icon}"></i> Convert to ${outputExt.toUpperCase()}`;
      preview.innerHTML = `
        <div class="server-status">
          <div style="font-size:32px;color:var(--danger);margin-bottom:12px">
            <i class="fa-solid fa-circle-xmark"></i>
          </div>
          <b>Conversion failed</b>
          <span>${esc(friendly)}</span>
        </div>
      `;
    }
  }

  function successBar(url, filename, size) {
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
        const ext = "." + outputExt;
        let v = input.value.trim() || "output";
        if (!v.endsWith(ext)) v += ext;
        $id("wsDownload").setAttribute("download", v);
        const nameEl = $id("wsResultName");
        if (nameEl) nameEl.textContent = v;
        toast(`Renamed to ${v}`);
        close();
      };
    };
    $id("wsDownload").addEventListener("click", () => clearState(id));
  }

  return {
    id,
    name,
    desc,
    icon,
    color,
    mount
  };
}

// ============================================================
// EXPORT THE THREE SERVER TOOLS
// ============================================================
export const pdf2wordTool = makeServerTool({
  id: "pdf2word",
  name: "PDF to Word",
  desc: "Convert PDF text to an editable Word document.",
  icon: "fa-file-word",
  color: "#1a6dff",
  outputExt: "docx",
  outputLabel: "Word document"
});

export const pdf2excelTool = makeServerTool({
  id: "pdf2excel",
  name: "PDF to Excel",
  desc: "Convert PDF text to an editable spreadsheet.",
  icon: "fa-file-excel",
  color: "#1e6b3a",
  outputExt: "xlsx",
  outputLabel: "Excel spreadsheet"
});

export const pdf2pptTool = makeServerTool({
  id: "pdf2ppt",
  name: "PDF to PowerPoint",
  desc: "Convert PDF pages to editable slides.",
  icon: "fa-file-powerpoint",
  color: "#e67e22",
  outputExt: "pptx",
  outputLabel: "PowerPoint presentation"
});