// js/admin.js
// Admin panel — loaded only by app.html (which also loads app.js).

import { auth, fns } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { S } from "./app.js";

const $ = (i) => document.getElementById(i);
const call = (n) => httpsCallable(fns, n);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[c]));

let kind = "users";

document.addEventListener("aafa:render", async () => {
  const ok =
    S.U && (await auth.currentUser.getIdTokenResult()).claims.admin;
  document.querySelectorAll(".adminLink").forEach((a) =>
    a.classList.toggle("hidden", !ok)
  );
});

async function stats() {
  try {
    const s = (await call("adminStats")()).data;
    const L = [
      ["Total Users", s.users],
      ["Active (30d)", s.active],
      ["Free Users", s.free],
      ["Premium Users", s.premium],
      ["Documents", s.docs],
      ["Pages Indexed", s.pages.toLocaleString()],
      ["Webified Sites", s.sites],
      ["Revenue (USD)", "$" + s.revenue.toFixed(2)],
      ["Failed Jobs", s.failed]
    ];
    $("adStats").innerHTML = L.map(
      ([l, v]) =>
        `<div class="card" style="cursor:default"><span class="meta">${l}</span><h3>${v}</h3></div>`
    ).join("");
  } catch (e) {
    console.error(e);
    $("adStats").innerHTML = "<p>We couldn't load admin data.</p>";
  }
}

async function list(k) {
  kind = k;
  $("adList").innerHTML = '<p class="meta">Loading...</p>';
  try {
    const r = (await call("adminList")({ kind: k })).data.rows;
    $("adList").innerHTML =
      r
        .map(
          (x) =>
            `<div class="card" style="cursor:default;margin-bottom:8px">
          <b>${esc(x.name || x.email)}</b>
          <span class="meta">${esc(
            [
              x.email,
              x.plan,
              x.status,
              x.pages && x.pages + " pages",
              x.amount,
              x.usd && "$" + x.usd,
              x.error
            ]
              .filter(Boolean)
              .join(" · ")
          )}</span>
          ${
            x.path.includes("/documents/")
              ? ` <button class="btn" data-ad="reprocess" data-p="${x.path}">Reprocess</button>
                 <button class="btn" data-ad="${x.disabled ? "enable" : "disable"}" data-p="${x.path}">${x.disabled ? "Enable" : "Disable"}</button>
                 <button class="btn" data-ad="delete" data-p="${x.path}">Delete</button>`
              : ""
          }
        </div>`
        )
        .join("") || "<p class='meta'>Nothing here.</p>";
  } catch (e) {
    console.error(e);
    $("adList").innerHTML = "<p>We couldn't load this list.</p>";
  }
}

document.addEventListener("click", async (e) => {
  const g = (s) => e.target.closest(s);
  let x;

  if (g('[data-nav="admin"]')) {
    stats();
    list("users");
  }

  if ((x = g("[data-adtab]"))) list(x.dataset.adtab);

  if ((x = g("[data-ad]"))) {
    if (x.dataset.ad === "delete" && !confirm("Delete this document and its index?"))
      return;
    try {
      await call("adminAction")({ action: x.dataset.ad, path: x.dataset.p });
      S.toast("Done");
      list(kind);
    } catch (er) {
      console.error(er);
      S.toast("That action failed.");
    }
  }
});