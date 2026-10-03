// js/public.js
// Logic for the public landing page (index.html)

import { auth } from "./firebase.js";
import { watchUser, signUp, logIn, reset, logOut, social, friendly } from "./auth.js";

const $ = id => document.getElementById(id);

// ============================================================
// STATE
// ============================================================
let U = null;
let mode = "in";

// ============================================================
// REDIRECT: if user is signed in, go to app.html
// ============================================================
watchUser((user) => {
  U = user;
  if (user) {
    // Small delay so the auth state has time to settle
    setTimeout(() => { location.replace("app.html"); }, 300);
  }
});

// ============================================================
// AUTH MODAL
// ============================================================
function openAuthModal(m) {
  mode = m;
  setMode(m);
  $("authErr").textContent = "";
  $("authModal").classList.remove("hidden");
}

function closeAuthModal() {
  $("authModal").classList.add("hidden");
}

function setMode(m) {
  mode = m;
  $("authTitle").textContent = m === "in" ? "Welcome back" : "Create your PDF2WEB account";
  $("nameField").classList.toggle("hidden", m === "in");
  $("authGo").textContent = m === "in" ? "Log in" : "Create account";
  $("authSwap").textContent = m === "in"
    ? "New here? Create an account"
    : "Have an account? Log in";
}

// Wire buttons
$("loginBtnDesktop")?.addEventListener("click", () => openAuthModal("in"));
$("loginBtnDrawer")?.addEventListener("click", () => openAuthModal("in"));
$("signupBtnDesktop")?.addEventListener("click", () => openAuthModal("up"));
$("signupBtnDrawer")?.addEventListener("click", () => openAuthModal("up"));
$("heroSignup")?.addEventListener("click", () => openAuthModal("up"));
$("landingSignupBtn")?.addEventListener("click", () => openAuthModal("up"));
$("featuresSignupBtn")?.addEventListener("click", () => openAuthModal("up"));
$("authClose")?.addEventListener("click", closeAuthModal);
$("authSwap")?.addEventListener("click", (e) => {
  e.preventDefault();
  setMode(mode === "in" ? "up" : "in");
});

// Submit
$("authGo")?.addEventListener("click", async () => {
  $("authErr").textContent = "";
  try {
    if (mode === "in") {
      await logIn($("email").value, $("pass").value);
    } else {
      await signUp($("name").value, $("email").value, $("pass").value);
    }
    closeAuthModal();
    // watchUser will redirect to app.html
  } catch (e) {
    console.error(e);
    $("authErr").textContent = friendly(e);
  }
});

// Forgot password
$("forgot")?.addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await reset($("email").value);
    $("authErr").textContent = "Reset link sent. Check your email.";
  } catch (err) {
    $("authErr").textContent = friendly(err);
  }
});

// Social
document.querySelectorAll("[data-social]").forEach(b => {
  b.onclick = async () => {
    try {
      await social(b.dataset.social);
      closeAuthModal();
    } catch (e) {
      console.error(e);
      $("authErr").textContent = friendly(e);
    }
  };
});

// ============================================================
// VIEW SWITCHING (landing / features / pricing)
// ============================================================
function show(v) {
  document.querySelectorAll("main section").forEach(s => s.classList.add("hidden"));
  const target = $("view-" + v);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", a.dataset.nav === v)
  );
  closeDrawer();
  scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-nav]");
  if (n) {
    e.preventDefault();
    show(n.dataset.nav);
  }
  if (e.target.closest("[data-pricing]")) {
    show("pricing");
  }
});

// ============================================================
// DRAWER
// ============================================================
function openDrawer() {
  $("drawer").classList.add("open");
  $("backdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  $("drawer").classList.remove("open");
  $("backdrop").classList.add("hidden");
  document.body.style.overflow = "";
}
$("menuBtn")?.addEventListener("click", openDrawer);
$("drawerClose")?.addEventListener("click", closeDrawer);
$("backdrop")?.addEventListener("click", closeDrawer);

// ============================================================
// UPGRADE → tell user to sign in
// ============================================================
$("pricingUpgradeBtn")?.addEventListener("click", () => {
  if (!U) {
    openAuthModal("up");
  } else {
    location.replace("app.html");
  }
});

$("payGo")?.addEventListener("click", () => {
  if (U) location.replace("app.html");
  else openAuthModal("up");
  $("payModal").classList.add("hidden");
});
$("payClose")?.addEventListener("click", () => {
  $("payModal").classList.add("hidden");
});

// ============================================================
// INITIAL VIEW
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  $("authModal")?.classList.add("hidden");
  show("landing");
});