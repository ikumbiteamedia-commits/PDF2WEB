// js/nav.js
// Shared app chrome wiring: mobile drawer, [data-nav] links, profile blocks, admin link.
// Loaded by app.js (dashboard) and directly by tools.html so both pages have an identical navbar.
// Decision: on pages without the dashboard views, [data-nav="x"] links go to app.html#x.

import { auth } from "./firebase.js";
import { watchUser } from "./auth.js";
import { FREE_UPLOADS } from "./documents.js";
import { esc } from "./util.js";

const $ = (id) => document.getElementById(id);

// ============================================================
// DRAWER
// ============================================================
export function openDrawer() {
  $("drawer")?.classList.add("open");
  $("backdrop")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

export function closeDrawer() {
  $("drawer")?.classList.remove("open");
  $("backdrop")?.classList.add("hidden");
  // tools.html locks body scroll itself (overflow hidden in CSS) — only clear our inline override
  document.body.style.overflow = "";
}

// ============================================================
// PROFILE BLOCK (sidebar + drawer)
// ============================================================
export const isPremium = (P) =>
  P?.plan === "premium" &&
  P?.subscriptionStatus === "active" &&
  P?.subscriptionExpiresAt?.toMillis?.() > Date.now();

export function profileHTML(U, P) {
  if (!U) return "";
  const n = P?.displayName || U.displayName || U.email || "User";
  const i = (n[0] || "U").toUpperCase();
  return `<button class="profile" data-nav="account">
    <span class="avatar">${
      U.photoURL ? `<img src="${esc(U.photoURL)}" width=38 height=38 style="border-radius:50%" alt="">` : esc(i)
    }</span>
    <span>
      <b>${esc(n)}</b>
      <small>${esc(U.email || "")}</small>
      ${isPremium(P)
        ? '<span class="tag prem">PREMIUM</span>'
        : `<span class="tag">FREE · ${P?.uploadCount || 0}/${FREE_UPLOADS} uploads</span>`}
    </span>
  </button>`;
}

// ============================================================
// INIT
// ============================================================
/**
 * @param {object}   opts
 * @param {Function} [opts.onNavigate]  Called with the view name. When omitted (e.g. tools.html)
 *                                      nav links redirect to app.html#<view>.
 * @param {boolean}  [opts.standalone]  Also watch auth to fill the profile blocks + admin link.
 */
export function initNav({ onNavigate, standalone = false } = {}) {
  $("menuBtn")?.addEventListener("click", openDrawer);
  $("drawerClose")?.addEventListener("click", closeDrawer);
  $("backdrop")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  document.addEventListener("click", (e) => {
    const n = e.target.closest("[data-nav]");
    if (!n) return;
    e.preventDefault();
    const view = n.dataset.nav;
    if (typeof onNavigate === "function") onNavigate(view);
    else location.href = `app.html#${encodeURIComponent(view)}`;
  });

  // Mark the current page's drawer link active (e.g. "PDF Tools" on tools.html)
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("#drawer nav a[href]").forEach((a) => {
    const target = (a.getAttribute("href") || "").split("#")[0];
    if (target && target === here) a.classList.add("active");
  });

  if (standalone) {
    // Header search on non-dashboard pages hands the query over to the dashboard's Search view
    $("hSearch")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const v = e.target.value.trim();
      if (!v) return;
      try { sessionStorage.setItem("pdf2web_pending_search", v); } catch {}
      location.href = "app.html#search";
    });

    watchUser(async (u, p) => {
      if (!u) { location.replace("index.html"); return; }
      const html = profileHTML(u, p);
      if ($("drawerProfile")) $("drawerProfile").innerHTML = html;
      if ($("sideProfile")) $("sideProfile").innerHTML = html;
      try {
        const claims = (await auth.currentUser.getIdTokenResult()).claims;
        document.querySelectorAll(".adminLink").forEach((a) => a.classList.toggle("hidden", !claims.admin));
      } catch {}
    });
  }
}

// Pages opt in with <body data-nav-standalone> (tools.html does) — no inline script needed.
if (document.body && document.body.hasAttribute("data-nav-standalone")) {
  initNav({ standalone: true });
}
