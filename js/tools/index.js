// js/tools/index.js
// (formatBytes now re-exported from js/util.js so every tool shows sizes the same way)
// Tools shell — renders the tool grid, dispatches to per-tool workspaces.

import { auth, db } from "../firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { mergeTool } from "../tools-merge.js";   // page-picker merge (replaces ./merge.js)
import { watermarkTool } from "./watermark.js";
import { signTool } from "./sign.js";
import { compressTool } from "./compress.js";
import { rotateTool } from "./rotate.js";
import { deletePagesTool } from "./delete-pages.js";
import { extractPagesTool } from "./extract-pages.js";
import { jpg2pdfTool } from "./jpg2pdf.js";
import { pdf2jpgTool } from "./pdf2jpg.js";
import { splitTool } from "./split.js";
import { pdf2wordTool, pdf2excelTool, pdf2pptTool } from "./server.js";

// ============================================================
// TOOL REGISTRY
// ============================================================
export const TOOLS = [
  // Organize
  mergeTool,
  splitTool,
  deletePagesTool,
  extractPagesTool,
  // Modify
  compressTool,
  rotateTool,
  watermarkTool,
  signTool,
  // Convert
  pdf2jpgTool,
  jpg2pdfTool,
  pdf2wordTool,
  pdf2excelTool,
  pdf2pptTool
];

// ============================================================
// SHARED STATE
// ============================================================
export const state = {
  user: null,
  activeTool: null,
  onExit: null,
};

// ============================================================
// TOAST
// ============================================================
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ============================================================
// AUTH GUARD
// ============================================================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.replace("index.html");
    return;
  }
  state.user = user;
});

// ============================================================
// RENDER NAV + GRID
// ============================================================
const $ = (id) => document.getElementById(id);

function renderNav() {
  const nav = $("toolsNavList");
  if (!nav) return;
  nav.innerHTML = TOOLS.map(
    (t) => `<div class="tools-nav-item" data-tool="${t.id}">
      <i class="fa-solid ${t.icon}"></i>
      <span>${t.name}</span>
    </div>`
  ).join("");
}

function renderGrid() {
  const grid = $("toolsGrid");
  if (!grid) return;
  grid.innerHTML = TOOLS.map(
    (t) => `<div class="tool-card" data-tool="${t.id}">
      <div class="tool-icon" style="color:${t.color}"><i class="fa-solid ${t.icon}"></i></div>
      <b>${t.name}</b>
      <span>${t.desc}</span>
    </div>`
  ).join("");
}

renderNav();
renderGrid();

// ============================================================
// OPEN / CLOSE WORKSPACE
// ============================================================
export function openWorkspace(toolId) {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) return;

  document.querySelectorAll(".tools-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.tool === toolId);
  });

  $("toolsLanding").classList.add("hidden");
  $("toolsWorkspace").classList.remove("hidden");
  $("toolsWorkspace").innerHTML = "";

  state.activeTool = tool;

  if (typeof tool.mount === "function") {
    tool.mount($("toolsWorkspace"), exitWorkspace);
  } else {
    toast("This tool is coming soon.");
    exitWorkspace();
  }
}

export function exitWorkspace() {
  document.querySelectorAll(".tools-nav-item").forEach((el) =>
    el.classList.remove("active")
  );
  $("toolsWorkspace").classList.add("hidden");
  $("toolsWorkspace").innerHTML = "";
  $("toolsLanding").classList.remove("hidden");
  state.activeTool = null;
  state.onExit = null;
}

// ============================================================
// GLOBAL CLICKS
// ============================================================
document.addEventListener("click", (e) => {
  const card = e.target.closest("[data-tool]");
  if (card) return openWorkspace(card.dataset.tool);
});

// ============================================================
// SHARED HELPERS
// ============================================================
export const $id = (id) => document.getElementById(id);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
// File sizes: one shared formatter (KB under 1 MB, MB with 1 decimal otherwise) — see js/util.js
export { formatBytes } from "../util.js";

// ============================================================
// SHARED UI HELPERS
// ============================================================

/**
 * Standard rename dialog. Calls onSave(newName) when confirmed.
 */
export function openRenameDialog(currentName, onSave) {
  const box = document.createElement("div");
  box.className = "rename-box";
  const base = String(currentName).replace(/\.[^.]+$/, "");
  const ext = (String(currentName).match(/\.[^.]+$/) || [".pdf"])[0];
  box.innerHTML = `
    <div class="box">
      <h3>Rename file</h3>
      <input type="text" id="renameInput" value="${esc(base)}">
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
    let v = input.value.trim() || "output";
    if (!v.endsWith(ext)) v += ext;
    onSave(v);
    toast(`Renamed to ${v}`);
    close();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("#renameSave").click();
    if (e.key === "Escape") close();
  });
}

/**
 * Standard success bar with Rename + Download.
 * Clears tool state automatically when Download is clicked.
 */
export function showSuccessBar(toolId, url, filename) {
  const right = document.getElementById("wsActionsRight");
  if (!right) return;
  right.innerHTML = `
    <button class="btn" id="wsRename"><i class="fa-solid fa-pen"></i> Rename</button>
    <a class="btn primary" id="wsDownload"
       href="${url}" download="${esc(filename)}"
       style="min-width:220px">
      <i class="fa-solid fa-download"></i> Download
    </a>
  `;
  document.getElementById("wsRename").onclick = () =>
    openRenameDialog(filename, (newName) => {
      document.getElementById("wsDownload").setAttribute("download", newName);
      const nameEl = document.getElementById("wsResultName");
      if (nameEl) nameEl.textContent = newName;
    });

  document.getElementById("wsDownload").addEventListener("click", () => {
    import("./storage.js").then(({ clearState }) => clearState(toolId));
  });
}