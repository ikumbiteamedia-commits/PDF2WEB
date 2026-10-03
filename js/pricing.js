// js/pricing.js
// Pricing page + app.html pricing section — safe on any page.

import { auth, db, fns } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = id => document.getElementById(id);
const call = name => httpsCallable(fns, name);
const toastEl = $("toast");

const CURRENCY_BY_COUNTRY = {
  KE: "KES", UG: "UGX", TZ: "TZS", US: "USD",
  GB: "USD", CA: "USD", AU: "USD", IN: "USD", NG: "USD", ZA: "USD",
};
const FLAG = { USD: "🇺🇸", KES: "🇰🇪", UGX: "🇺🇬", TZS: "🇹🇿" };
const COUNTRY_NAME = {
  KE: "Kenya", UG: "Uganda", TZ: "Tanzania", US: "United States",
  GB: "United Kingdom", CA: "Canada", AU: "Australia", IN: "India",
  NG: "Nigeria", ZA: "South Africa"
};

let currentUser = null;
let currentCurrency = "USD";
let rates = { USD: 1 };
let detectedCountry = "";

function toast(msg, ms = 2600) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), ms);
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function formatLocal(usd, currency, rate) {
  if (currency === "USD" || !rate || rate <= 1) return "";
  const local = Math.ceil(usd * rate);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: 0
    }).format(local);
  } catch (err) {
    return `${currency} ${local.toLocaleString()}`;
  }
}

// Rough client-side country guess — used when the server headers don't say
function guessCountry() {
  const m = (navigator.language || "").match(/-([A-Z]{2})$/);
  if (m) return m[1];
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/Nairobi/i.test(tz)) return "KE";
    if (/Kampala/i.test(tz)) return "UG";
    if (/Dar_es_Salaam/i.test(tz)) return "TZ";
  } catch {}
  return "US";
}

async function detectGeo() {
  const guessed = guessCountry();
  try {
    const res = await call("getPricing")({
      currency: null,
      locale: navigator.language,
      country: guessed
    });
    console.log("getPricing response:", JSON.stringify(res.data, null, 2));
    detectedCountry = res.data.country || guessed;
    currentCurrency = res.data.currency || CURRENCY_BY_COUNTRY[guessed] || "USD";
    rates = res.data.rates || { USD: 1 };
    return res.data;
  } catch (err) {
    console.warn("getPricing failed, using fallback:", err);
  }

  detectedCountry = guessed;
  currentCurrency = CURRENCY_BY_COUNTRY[guessed] || "USD";
  const fallback = { USD: 1, KES: 129, UGX: 3800, TZS: 2600 };
  rates = fallback;
  return { country: guessed, currency: currentCurrency, rates: fallback };
}

function renderPrices() {
  const weeklyUsd = 20;
  const monthlyUsd = 40;

  const weeklyLocal = formatLocal(weeklyUsd, currentCurrency, rates[currentCurrency]);
  const monthlyLocal = formatLocal(monthlyUsd, currentCurrency, rates[currentCurrency]);

  // pricing.html — cards
  setText("weeklyLocalLabel", weeklyLocal ? `≈ ${weeklyLocal}` : "");
  setText("monthlyLocalLabel", monthlyLocal ? `≈ ${monthlyLocal}` : "");
  setText("weeklyNote", weeklyLocal
    ? `Billed as $${weeklyUsd} USD · approx. ${weeklyLocal}`
    : `Billed as $${weeklyUsd} USD`);
  setText("monthlyNote", monthlyLocal
    ? `Billed as $${monthlyUsd} USD · approx. ${monthlyLocal}`
    : `Billed as $${monthlyUsd} USD`);

  const flag = FLAG[currentCurrency] || "🌍";
  const name = COUNTRY_NAME[detectedCountry] || detectedCountry || "your region";
  setText("geoLabel", `${flag} ${name} · prices in ${currentCurrency}`);

  // app.html — pricing section shows one premium price
  const pp = $("premiumPrice");
  if (pp) {
    pp.textContent = `$${monthlyUsd}/mo` + (monthlyLocal ? ` · ≈ ${monthlyLocal}` : "");
  }

  // Sync any currency selects
  const sel = $("currencySelect");
  if (sel) sel.value = currentCurrency;
  const sel2 = $("curSel");
  if (sel2 && !sel2.options.length) {
    sel2.innerHTML = ["USD","KES","UGX","TZS"].map(c => `<option value="${c}">${c}</option>`).join("");
  }
  if (sel2) sel2.value = currentCurrency;
  const sel3 = $("curSelPage");
  if (sel3 && !sel3.options.length) {
    sel3.innerHTML = ["USD","KES","UGX","TZS"].map(c => `<option value="${c}">${c}</option>`).join("");
  }
  if (sel3) sel3.value = currentCurrency;
}

async function renderCurrentSubscription() {
  if (!currentUser) {
    const banner = $("currentSub");
    if (banner) banner.classList.add("hidden");
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const data = snap.data() || {};
    const isPrem =
      data.plan === "premium" &&
      data.subscriptionStatus === "active" &&
      (data.subscriptionExpiresAt?.toMillis?.() ?? 0) > Date.now();

    const banner = $("currentSub");
    if (!banner) return;
    if (!isPrem) { banner.classList.add("hidden"); return; }

    const expires = data.subscriptionExpiresAt?.toDate?.();
    const expiresStr = expires ? expires.toLocaleDateString() : "soon";

    banner.classList.remove("hidden");
    banner.innerHTML = `
      <i class="fa-solid fa-crown"></i>
      You're on <b>Premium${data.subscriptionPlan ? " (" + data.subscriptionPlan + ")" : ""}</b> —
      active until <b>${expiresStr}</b>.
    `;
  } catch (err) {
    console.error(err);
  }
}

// ============================================================
// SIMULATED PURCHASE — client-side Firestore write
// ============================================================
async function purchase(planId) {
  if (!currentUser) {
    toast("Please sign in first.");
    setTimeout(() => location.href = "index.html", 900);
    return;
  }

  const btn = document.querySelector(`[data-plan="${planId}"]`);
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing…`; }

  try {
    const PLAN_DAYS = { weekly: 7, monthly: 30 };
    const days = PLAN_DAYS[planId] || 7;

    const userRef = doc(db, "users", currentUser.uid);
    const snap = await getDoc(userRef);
    const current = snap.data() || {};
    const currentExpiry = current.subscriptionExpiresAt?.toMillis?.() ?? 0;
    const baseMs = Math.max(Date.now(), currentExpiry);
    const newExpiryMs = baseMs + days * 86400 * 1000;

    await updateDoc(userRef, {
      plan: "premium",
      subscriptionStatus: "active",
      subscriptionPlan: planId,
      subscriptionStartedAt: new Date(),
      subscriptionExpiresAt: new Date(newExpiryMs),
      paymentProvider: "simulated",
      lastTransactionAt: new Date()
    });

    toast("Premium activated. Enjoy!", 2400);
    await renderCurrentSubscription();

    const params = new URLSearchParams(location.search);
    let next = params.get("return");
    if (!next && document.referrer && !document.referrer.includes("pricing.html")) {
      try {
        const u = new URL(document.referrer);
        next = u.pathname + u.search;
      } catch {}
    }
    if (!next) next = "app.html";

    setTimeout(() => location.href = next, 1200);
  } catch (err) {
    console.error(err);
    toast(err?.message || "Couldn't activate Premium. Try again.", 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

// ============================================================
// WIRE UP
// ============================================================
document.querySelectorAll("[data-plan]").forEach(btn => {
  btn.addEventListener("click", () => purchase(btn.dataset.plan));
});

// The Upgrade button on app.html — navigates to pricing.html with a return URL
const upgradeBtn = $("pricingUpgradeBtn");
if (upgradeBtn) {
  upgradeBtn.addEventListener("click", () => {
    location.href = `pricing.html?return=${encodeURIComponent(location.pathname + location.search)}`;
  });
}

$("currencySelect")?.addEventListener("change", (e) => {
  const newCur = e.target.value;
  if (newCur === currentCurrency) return;
  currentCurrency = newCur;
  if (!rates[newCur]) {
    call("getPricing")({ currency: newCur, locale: navigator.language, country: detectedCountry })
      .then(res => { rates = res.data.rates || rates; renderPrices(); })
      .catch(err => { console.error(err); toast("Could not load that currency."); });
  } else {
    renderPrices();
  }
});

$("curSel")?.addEventListener("change", (e) => {
  currentCurrency = e.target.value;
  renderPrices();
});

$("curSelPage")?.addEventListener("change", (e) => {
  currentCurrency = e.target.value;
  renderPrices();
});

// ============================================================
// AUTH
// ============================================================
onAuthStateChanged(auth, async user => {
  currentUser = user;
  await detectGeo();
  renderPrices();
  await renderCurrentSubscription();
});