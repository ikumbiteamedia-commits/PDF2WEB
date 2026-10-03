// functions/webify.js — BACKEND (CommonJS)
// Gemini designs the full site (ai.js); the PDF supplies ALL the content; render.js draws it.
//
// Decisions (noted per the brief):
//  * Completeness: every level-0 heading must be covered by a section (as source or merged heading).
//    The "section count >= 60% of headings" rule is capped at MAX_SECTIONS (15), otherwise a 100-heading
//    document could never pass while the design brief asks for 8-15 sections. Uncovered headings are merged
//    into the preceding section instead of being dropped.
//  * Firestore documents are capped at 1 MB, so each section keeps up to ~16k characters of source text
//    (total budget 200k); a section that is cut gets `truncated: true` and the renderer says so.
//  * Firestore rejects `undefined`. Every optional field below falls back to a concrete value
//    (false / "" / [] / 0) so writes never fail.

const { onCall, onRequest } = require("firebase-functions/v2/https"),
      { db, FV, need, isPrem, audit, HttpsError } = require("./util"),
      { render, sigOf } = require("./render"),
      { analyzeDocument, structureSections, fallbackStructure, toParagraphs, MAX_SECTIONS, MIN_SECTIONS } = require("./ai");

const LAYOUT_VERSION = 2;
const TOTAL_CHAR_BUDGET = 200000;

// ============================================================
// WEBIFY DOCUMENT
// ============================================================
exports.webifyDocument = onCall({ memory: "1GiB", timeoutSeconds: 540 }, async r => {
  const uid = need(r);
  if (!await isPrem(uid)) throw new HttpsError("permission-denied", "Webify is a Premium feature");

  const docId = r.data.docId;
  const dr = db.doc(`users/${uid}/documents/${docId}`);
  const D = (await dr.get()).data();
  if (!D || D.status !== "ready") throw new HttpsError("failed-precondition", "Document is not ready");

  const totalPages = Math.max(1, Number(D.pages) || 1);

  // ---------- STEP 1: load every page's text once (needed for sections AND samples) ----------
  const pageText = await loadPages(dr, totalPages);

  // ---------- STEP 2: headings (deduped, in document order) ----------
  const headings = buildHeadings(D.toc || []);
  const frontMatter = firstHeadingFrontMatter(pageText, headings);

  // ---------- STEP 3: AI context — up to 6 sample pages ----------
  const samples = pickSamplePages(totalPages).map(p => ({ page: p, text: (pageText[p] || "").slice(0, 1500) })).filter(s => s.text);
  const aiHeadings = headings.slice(0, 120).map(h => ({
    ...h, excerpt: excerptAfter(pageText, h, headings, 160)
  }));

  // ---------- STEP 4: ask AI to design the site ----------
  let design = null, aiUsed = false;
  try {
    const ctx = { headings: aiHeadings, samples, frontMatter };
    design = await analyzeDocument(D, ctx);
    design = await ensureComplete(design, aiHeadings, D, ctx);
    aiUsed = design.sections.length > 0;
    console.log("AI design OK", { title: design.title, sections: design.sections.length, headings: aiHeadings.length });
  } catch (err) {
    console.error("AI design failed, using straight mapping:", err.message);
    design = null;
  }

  // ---------- STEP 5: sections (source text + structured bodies) ----------
  const plan = design && design.sections.length
    ? design.sections
    : straightMapping(headings, totalPages);

  let sections = await buildSections(plan, headings, pageText, totalPages, aiUsed);

  // ---------- STEP 6: save ----------
  const metaTitle = cleanMetaTitle(D.meta?.title);
  const finalTitle = design?.title || metaTitle || D.displayName || "Document";
  const allText = Object.values(pageText).join(" ");

  const hero = design?.hero || {
    kicker: "Document", heading: finalTitle, subheading: "",
    primaryCtaText: "Start reading", secondaryCtaText: "Get in touch",
  };

  const ref = db.collection(`users/${uid}/websites`).doc();
  await ref.set({
    ownerId: uid,
    documentId: docId,
    layoutVersion: LAYOUT_VERSION,
    title: finalTitle,
    slug: D.slug || slugify(finalTitle),
    subtitle: design?.subtitle || hero.subheading || "",
    hero: design?.heroText || `Generated from ${D.displayName} (${D.pages} pages).`,
    heroBlock: hero,
    docType: design?.docType || "other",
    template: "classic",
    colors: {},
    sections,
    cta: design?.cta || { heading: "Ready to learn more?", text: "Explore the full document or get in touch.", buttonText: "Get in touch" },
    ctaTitle: design?.cta?.heading || "Ready to learn more?",
    ctaText: design?.cta?.text || "Explore the full document or get in touch.",
    footer: design?.footer || { tagline: design?.subtitle || "", columns: [] },
    contact: extractContact(allText),
    pageCount: totalPages,
    visibility: "private",
    status: "draft",
    views: 0,
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp()
  });

  await audit("webify_completed", uid, { siteId: ref.id, aiUsed, sections: sections.length, headings: headings.length, layoutVersion: LAYOUT_VERSION });
  return { id: ref.id };
});

// ============================================================
// PAGE LOADING
// ============================================================
async function loadPages(dr, n) {
  const out = {};
  const refs = [];
  for (let p = 1; p <= n; p++) refs.push(dr.collection("pages").doc(String(p)));
  const CHUNK = 300;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const snaps = await db.getAll(...refs.slice(i, i + CHUNK));
    snaps.forEach(s => { out[Number(s.id)] = cleanPage(s.exists ? (s.data().text || "") : ""); });
  }
  return out;
}

// Removes running headers like "Page 3 of 9 TITLE"; keeps everything else.
function cleanPage(t) {
  return String(t || "").replace(/Page\s+\d+\s+of\s+\d+\s+[A-Z][A-Z\s]{2,60}/g, " ").replace(/\s+/g, " ").trim();
}

// first + 25% + 50% + 75% + last + 1 random (distinct), up to 6
function pickSamplePages(n) {
  const set = new Set([1, Math.ceil(n * .25), Math.ceil(n * .5), Math.ceil(n * .75), n]);
  const pool = [];
  for (let p = 1; p <= n; p++) if (!set.has(p)) pool.push(p);
  if (pool.length) set.add(pool[Math.floor(Math.random() * pool.length)]);
  return [...set].filter(p => p >= 1 && p <= n).sort((a, b) => a - b).slice(0, 6);
}

// ============================================================
// HEADINGS
// ============================================================
function buildHeadings(toc) {
  const seen = new Set(), out = [];
  for (const h of toc) {
    const title = String(h.title || "").replace(/\s+/g, " ").trim();
    const key = title.toLowerCase();
    if (title.length < 3 || seen.has(key)) continue;
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(title) || /^\d+$/.test(title)) continue;
    seen.add(key);
    out.push({ idx: out.length, title, level: h.level ?? 0, page: Number(h.page) || 1 });
  }
  return out;
}

function firstHeadingFrontMatter(pageText, headings) {
  if (!headings.length) return (pageText[1] || "").slice(0, 700);
  const h = headings[0];
  const t = pageText[h.page] || "";
  const at = t.toLowerCase().indexOf(h.title.toLowerCase());
  return h.page === 1 && at > 20 ? t.slice(0, at) : "";
}

function excerptAfter(pageText, h, headings, len) {
  const t = pageText[h.page] || "";
  const at = t.toLowerCase().indexOf(h.title.toLowerCase());
  return t.slice(at >= 0 ? at + h.title.length : 0, (at >= 0 ? at + h.title.length : 0) + len).trim();
}

// ============================================================
// COMPLETENESS CHECK (Fix 6d)
// ============================================================
function coverage(design, headings) {
  const covered = new Set();
  design.sections.forEach(s => { covered.add(s.sourceIndex); (s.mergedIndexes || []).forEach(i => covered.add(i)); });
  const lvl0 = headings.filter(h => h.level === 0);
  const missing = lvl0.filter(h => !covered.has(h.idx));
  const need = Math.min(Math.ceil(headings.length * 0.6), MAX_SECTIONS);
  return { missing, enough: design.sections.length >= need, need };
}

async function ensureComplete(design, headings, D, ctx) {
  if (!headings.length) return design;
  let c = coverage(design, headings);
  if (!c.missing.length && c.enough) return design;

  console.warn("completeness failed", { sections: design.sections.length, missingLevel0: c.missing.length, need: c.need });
  try {
    const again = await analyzeDocument(D, ctx, { strict: true });
    const c2 = coverage(again, headings);
    if ((c2.missing.length < c.missing.length) || (c2.enough && !c.enough)) { design = again; c = c2; }
  } catch (e) { console.warn("strict retry failed:", e.message); }

  if (c.missing.length && design.sections.length) {
    const ordered = [...design.sections].sort((a, b) => hPage(headings, a.sourceIndex) - hPage(headings, b.sourceIndex) || a.sourceIndex - b.sourceIndex);
    for (const h of c.missing) {
      let target = ordered[0];
      for (const s of ordered) if (s.sourceIndex <= h.idx) target = s;
      (target.mergedIndexes = target.mergedIndexes || []).push(h.idx);
    }
    c = coverage(design, headings);
  }
  if (!c.enough && headings.length <= MAX_SECTIONS) {
    design.sections = headings.map(h => ({
      sourceIndex: h.idx, mergedIndexes: [], title: h.title, type: "prose", summary: "", icon: ""
    }));
  }
  return design;
}
const hPage = (headings, i) => headings.find(h => h.idx === i)?.page || 0;

function straightMapping(headings, totalPages) {
  if (!headings.length) {
    const step = Math.max(1, Math.ceil(totalPages / 8)), out = [];
    for (let p = 1; p <= totalPages; p += step) {
      const end = Math.min(totalPages, p + step - 1);
      out.push({ chunk: [p, end], sourceIndex: -1, mergedIndexes: [], title: end > p ? `Pages ${p}–${end}` : `Page ${p}`, type: "prose", summary: "", icon: "" });
    }
    return out;
  }
  const MAX = 30;
  const secs = headings.slice(0, MAX).map(h => ({ sourceIndex: h.idx, mergedIndexes: [], title: h.title, type: "prose", summary: "", icon: "" }));
  headings.slice(MAX).forEach(h => secs[secs.length - 1].mergedIndexes.push(h.idx));
  return secs;
}

// ============================================================
// BUILD SECTIONS
// ============================================================
async function buildSections(plan, headings, pageText, totalPages, aiUsed) {
  const ordered = plan.map(p => {
    if (p.chunk) return { ...p, startPage: p.chunk[0], startTitle: "" };
    const idxs = [p.sourceIndex, ...(p.mergedIndexes || [])].filter(i => i >= 0);
    const hs = idxs.map(i => headings.find(h => h.idx === i)).filter(Boolean).sort((a, b) => a.idx - b.idx);
    const first = hs[0] || headings.find(h => h.idx === p.sourceIndex);
    return { ...p, hs, startPage: first?.page || 1, startTitle: first?.title || "", firstIdx: first?.idx ?? 0 };
  }).sort((a, b) => (a.startPage - b.startPage) || ((a.firstIdx ?? 0) - (b.firstIdx ?? 0)));

  const perCap = Math.max(4000, Math.min(16000, Math.floor(TOTAL_CHAR_BUDGET / Math.max(1, ordered.length))));
  const startOf = s => {
    const t = (pageText[s.startPage] || "");
    const at = s.startTitle ? t.toLowerCase().indexOf(s.startTitle.toLowerCase()) : -1;
    return { page: s.startPage, off: at > 0 ? at : 0 };
  };
  const starts = ordered.map(startOf);

  const raw = ordered.map((s, i) => {
    const a = starts[i];
    const next = starts[i + 1];
    const endPage = s.chunk ? s.chunk[1] : (next ? next.page : totalPages);
    const endOff = next && next.page === endPage ? next.off : Infinity;
    let parts = [];
    for (let p = a.page; p <= endPage && p <= totalPages; p++) {
      let t = pageText[p] || "";
      if (p === a.page && a.off) t = t.slice(a.off);
      if (p === endPage && endOff !== Infinity && !(p === a.page && endOff <= a.off)) t = t.slice(0, p === a.page ? Math.max(0, endOff - a.off) : endOff);
      parts.push(t);
    }
    let text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (s.startTitle && text.toLowerCase().startsWith(s.startTitle.toLowerCase())) {
      text = text.slice(s.startTitle.length).replace(/^[\s:.\-–]+/, "").trim();
    }
    let truncated = false;
    if (text.length > perCap) {
      let cut = text.lastIndexOf(". ", perCap);
      if (cut < perCap * .6) cut = perCap;
      text = text.slice(0, cut + 1); truncated = true;
    }
    const lastPage = Math.max(a.page, Math.min(endPage - (next && next.page === endPage && endOff !== Infinity ? 0 : (next ? 1 : 0)), totalPages));
    return { s, text, truncated, startPage: a.page, endPage: Math.max(a.page, lastPage) };
  });

  let structured;
  if (aiUsed) {
    structured = await structureSections(raw.map((x, i) => ({ id: "s" + i, title: x.s.title, type: x.s.type || "prose", text: x.text })));
  } else {
    structured = raw.map(x => ({ ...fallbackStructure("prose", x.text), method: "fallback" }));
  }

  return raw.map((x, i) => {
    const st = structured[i] || fallbackStructure(x.s.type || "prose", x.text);
    const text = bodyToHtml(st.type, st.body, st.extra);
    return {
      id: "s" + i,
      title: x.s.title || "Untitled",
      type: st.type || "prose",
      summary: x.s.summary || "",
      icon: x.s.icon || "",
      page: x.startPage || 1,
      pages: x.endPage > x.startPage ? `${x.startPage}–${x.endPage}` : String(x.startPage || 1),
      body: st.body === undefined ? null : st.body,
      extra: Array.isArray(st.extra) ? st.extra : [],
      text: text || "",
      textSig: sigOf(text || ""),
      sourceHeadings: (x.s.hs || []).map(h => h.title).slice(0, 12),
      truncated: x.truncated === true,   // ← always boolean, never undefined
      hidden: false
    };
  });
}

const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const P = a => (Array.isArray(a) ? a : []).map(t => String(t || "").trim()).filter(Boolean).map(t => `<p>${escapeHtml(t)}</p>`).join("");

function bodyToHtml(type, body, extra) {
  let h = "";
  switch (type) {
    case "specs": h = `<ul>${(body || []).map(r => `<li><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.value)}</li>`).join("")}</ul>`; break;
    case "bullets": h = `<ul>${(body || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`; break;
    case "stats": h = `<ul>${(body || []).map(r => `<li><strong>${escapeHtml(r.value)}</strong> ${escapeHtml(r.label)}</li>`).join("")}</ul>`; break;
    case "quote": h = `<blockquote>${escapeHtml(body?.text || "")}</blockquote>`; break;
    case "feature": h = `${body?.heading ? `<p><strong>${escapeHtml(body.heading)}</strong></p>` : ""}<p>${escapeHtml(body?.text || "")}</p>`; break;
    case "timeline": h = `<ul>${(body || []).map(r => `<li><strong>${escapeHtml(r.label)}</strong> ${escapeHtml(r.text)}</li>`).join("")}</ul>`; break;
    case "table": h = `<table>${body?.headers?.length ? `<tr>${body.headers.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>` : ""}${(body?.rows || []).map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</table>`; break;
    case "comparison": h = ["left", "right"].map(k => `<p><strong>${escapeHtml(body?.[k]?.title || "")}</strong></p><ul>${(body?.[k]?.items || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`).join(""); break;
    case "gallery": h = (body || []).map(x => x.caption ? `<p><em>${escapeHtml(x.caption)}</em></p>` : "").join(""); break;
    case "cta": h = `<p>${escapeHtml(body?.text || "")}</p>`; break;
    default: h = P(body);
  }
  return h + P(extra);
}

// ============================================================
// CONTACT DETAILS
// ============================================================
function extractContact(text) {
  const uniq = a => [...new Set(a)].slice(0, 3);
  const emails = uniq(text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || []);
  const phones = uniq((text.match(/(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,4}\d{2,4}/g) || [])
    .map(s => s.trim()).filter(s => s.replace(/\D/g, "").length >= 9 && s.replace(/\D/g, "").length <= 15 && /[+\s().\-]/.test(s) && !/^(19|20)\d{2}\b/.test(s)));
  const urls = uniq((text.match(/\b(?:https?:\/\/|www\.)[^\s"<>()]+/gi) || []).map(u => u.replace(/[.,;:]+$/, "")));
  return { emails, phones, urls };
}

// ============================================================
// PREVIEW / PUBLISH / LIST / SITE
// ============================================================
exports.previewWebsite = onCall(async r => {
  const uid = need(r);
  const s = (await db.doc(`users/${uid}/websites/${r.data.siteId}`).get()).data();
  if (!s) throw new HttpsError("not-found", "Website not found");
  return { html: render(s, { preview: true }) };
});

exports.publishWebsite = onCall(async r => {
  const uid = need(r);
  const ref = db.doc(`users/${uid}/websites/${r.data.siteId}`);
  const s = (await ref.get()).data();
  if (!s) throw new HttpsError("not-found", "Website not found");

  const pub = db.doc(`publicWebsites/${ref.id}`);

  if (r.data.visibility !== "public") {
    await pub.delete().catch(() => {});
    await ref.update({ visibility: "private", status: "draft" });
    return {};
  }

  const base = slugify(s.slug || s.title) || "site";
  let slug = base, n = 1;
  for (;;) {
    const q = await db.collection("publicWebsites").where("slug", "==", slug).get();
    if (q.empty || q.docs[0].id === ref.id) break;
    slug = `${base}-${++n}`;
  }

  await pub.set({ ...s, slug, ownerId: uid, visibility: "public", status: "published", updatedAt: FV.serverTimestamp() }, { merge: true });
  await ref.update({ slug, visibility: "public", status: "published" });
  await audit("website_published", uid, { slug });
  return { slug };
});

exports.listSites = onCall(async r => {
  const uid = need(r);
  const snap = await db.collection(`users/${uid}/websites`).get();
  const sites = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const published = sites.filter(s => s.status === "published");
  const views = {};
  await Promise.all(published.map(async s => {
    try { views[s.id] = (await db.doc(`publicWebsites/${s.id}`).get()).data()?.views || 0; }
    catch { views[s.id] = 0; }
  }));

  return {
    sites: sites
      .map(s => ({ ...s, views: views[s.id] ?? s.views ?? 0 }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0))
  };
});

exports.site = onRequest(async (q, res) => {
  const slug = decodeURIComponent(q.path.split("/").filter(Boolean).pop() || "");
  const s = await db.collection("publicWebsites").where("slug", "==", slug).limit(1).get();
  if (s.empty) return res.status(404).send("<h1>Website not found</h1>");
  await s.docs[0].ref.update({ views: FV.increment(1) });
  res.set("Cache-Control", "public,max-age=60")
     .send(render(s.docs[0].data(), { url: `https://${q.get("host")}/webify/${slug}` }));
});

// ============================================================
// HELPERS
// ============================================================
function slugify(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function cleanMetaTitle(t) {
  if (!t) return "";
  const s = String(t).trim();
  if (["Not detected", "(anonymous)", "anonymous", "untitled", ""].includes(s.toLowerCase())) return "";
  return s.length < 3 ? "" : s;
}