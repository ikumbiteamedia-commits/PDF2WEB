// functions/webify.js — BACKEND (CommonJS)
// Calls Gemini (via ai.js) to design the site structure.
// Falls back to regex pipeline if AI fails.

const { onCall, onRequest } = require("firebase-functions/v2/https"),
      { db, FV, need, isPrem, audit, HttpsError } = require("./util"),
      { render } = require("./render"),
      { analyzeDocument } = require("./ai");

// ============================================================
// WEBIFY DOCUMENT — AI designs the site, PDF supplies the content
// ============================================================
exports.webifyDocument = onCall({
  memory: "1GiB",
  timeoutSeconds: 300
}, async r => {
  const uid = need(r);
  if (!await isPrem(uid)) throw new HttpsError("permission-denied", "Webify is a Premium feature");

  const docId = r.data.docId;
  const dr = db.doc(`users/${uid}/documents/${docId}`);
  const D = (await dr.get()).data();
  if (!D || D.status !== "ready") {
    throw new HttpsError("failed-precondition", "Document is not ready");
  }

  // ==========================================================
  // STEP 1 — Gather input for AI
  // ==========================================================
  const toc = (D.toc || []).slice(0, 60);

  // Pull a few sample pages for AI context (first page + 3 middle pages)
  const samplePages = [];
  try {
    if (toc.length) {
      const pageNums = new Set();
      pageNums.add(toc[0].page);
      if (toc.length > 3) pageNums.add(toc[Math.floor(toc.length / 3)].page);
      if (toc.length > 2) pageNums.add(toc[Math.floor(toc.length / 2)].page);
      if (toc.length > 1) pageNums.add(toc[toc.length - 1].page);

      const pageRefs = await Promise.all(
        [...pageNums].slice(0, 4).map(p => dr.collection("pages").doc(String(p)).get())
      );
      for (const snap of pageRefs) {
        if (snap.exists) {
          samplePages.push({
            page: Number(snap.id),
            text: (snap.data()?.text || "").slice(0, 1500)
          });
        }
      }
    }
  } catch (err) {
    console.warn("Sample page fetch failed:", err.message);
  }

  // ==========================================================
  // STEP 2 — Ask AI to design the site
  // ==========================================================
  let design;
  try {
    design = await analyzeDocument(D, samplePages);
    console.log("AI design OK", {
      title: design.title,
      sections: design.sections.length,
      docType: design.docType
    });
  } catch (err) {
    console.error("AI failed, falling back to regex:", err.message);
    design = null;
  }

  // ==========================================================
  // STEP 3 — Build sections
  // ==========================================================
  // If AI succeeded, use its section list to pull matching page text.
  // If not, fall back to the regex pipeline.

  let sections;
  if (design && design.sections.length) {
    sections = await buildSectionsFromAI(design, toc, dr, D);
  } else {
    sections = await buildSectionsFallback(toc, dr, D);
  }

  // ==========================================================
  // STEP 4 — Save the site
  // ==========================================================
  const metaTitle = cleanMetaTitle(D.meta?.title);
  const finalTitle = design?.title || metaTitle || D.displayName || "Document";

  const ref = db.collection(`users/${uid}/websites`).doc();

  await ref.set({
    ownerId: uid,
    documentId: docId,
    title: finalTitle,
    slug: D.slug || slugify(finalTitle),
    subtitle: design?.subtitle || "",
    hero: design?.heroText || `Generated from ${D.displayName} (${D.pages} pages).`,
    docType: design?.docType || "other",
    template: "classic",
    colors: {},
    sections,
    ctaTitle: design?.ctaTitle || "Ready to learn more?",
    ctaText: design?.ctaText || "Explore the original document for full details.",
    visibility: "private",
    status: "draft",
    views: 0,
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp()
  });

  await audit("webify_completed", uid, {
    siteId: ref.id,
    aiUsed: !!(design && design.sections.length),
    sections: sections.length
  });

  return { id: ref.id };
});

// ============================================================
// BUILD SECTIONS FROM AI DESIGN
// ============================================================
async function buildSectionsFromAI(design, toc, dr, D) {
  const usedPages = new Set();
  const out = [];

  for (let i = 0; i < design.sections.length; i++) {
    const aiSec = design.sections[i];
    const src = toc[aiSec.sourceIndex];
    if (!src) continue;

    // Fetch the source page's text
    let rawText = "";
    try {
      const pageSnap = await dr.collection("pages").doc(String(src.page)).get();
      rawText = pageSnap.data()?.text || "";
    } catch {}

    // Deduplicate: if this page was already used for another section, skip the intro
    const isFirstUse = !usedPages.has(src.page);
    usedPages.add(src.page);

    // Strip running header pattern like "Page N of M TITLE"
    rawText = rawText.replace(/Page\s+\d+\s+of\s+\d+\s+[A-Z][A-Z\s]+/g, " ").trim();

    // If we've already seen this page, strip the doc intro
    if (!isFirstUse) {
      const docIntro = (D.toc?.[0] ? "" : "");
      // Simple heuristic: strip the first 200 chars if they look generic
      const head = rawText.slice(0, 200).replace(/\s+/g, " ");
      if (/sample|demo|test|synthetic/i.test(head)) {
        rawText = rawText.slice(200).trim();
      }
    }

    // Convert to paragraphs
    const paragraphs = rawText
      .split(/(?<=[.!?])\s+(?=[A-Z“"'(])/)
      .map(p => p.trim())
      .filter(p => p.length > 25)
      .slice(0, 20);

    const html = paragraphs.length
      ? paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")
      : `<p>${escapeHtml(rawText.slice(0, 400))}</p>`;

    // Determine the "pages" field (range if heading spans multiple pages)
    const nextSource = toc[aiSec.sourceIndex + 1];
    const startPage = src.page;
    const endPage = nextSource && nextSource.page > startPage
      ? nextSource.page - 1
      : startPage;

    const pagesStr = endPage > startPage ? `${startPage}–${endPage}` : String(startPage);

    out.push({
      id: `s${i}`,
      title: aiSec.title,
      type: aiSec.type,
      summary: aiSec.summary,
      page: startPage,
      pages: pagesStr,
      text: html,
      hidden: false
    });
  }

  // If AI produced fewer than 2 usable sections, bail to fallback
  if (out.length < 2) {
    return await buildSectionsFallback(toc, dr, D);
  }

  return out;
}

// ============================================================
// FALLBACK — old regex-based section building
// ============================================================
async function buildSectionsFallback(toc, dr, D) {
  // Dedupe consecutive same-title headings
  const merged = [];
  for (const h of toc) {
    const t = (h.title || "").trim();
    if (!t) continue;
    const last = merged[merged.length - 1];
    if (last && last.title.toLowerCase() === t.toLowerCase()) {
      last.endPage = h.page;
    } else {
      merged.push({ title: t, page: h.page, endPage: h.page, level: h.level || 0 });
    }
  }

  const trimmed = merged.slice(0, 12);

  // Pull page text
  const pageRefs = await Promise.all(
    trimmed.map(h => dr.collection("pages").doc(String(h.page)).get())
  );

  const docIntro = (pageRefs[0]?.data()?.text || "").slice(0, 250).replace(/\s+/g, " ").trim();

  return trimmed.map((h, i) => {
    let raw = pageRefs[i]?.data()?.text || "";

    if (i > 0 && docIntro.length > 40 && raw.includes(docIntro)) {
      raw = raw.replace(docIntro, "").trim();
    }
    raw = raw.replace(/Page\s+\d+\s+of\s+\d+\s+[A-Z][A-Z\s]+/g, " ").replace(/\s+/g, " ").trim();

    const titleLower = (h.title || "").toLowerCase();
    if (titleLower && raw.toLowerCase().startsWith(titleLower)) {
      raw = raw.slice(h.title.length).replace(/^[\s:.\-]+/, "").trim();
    }

    const paragraphs = raw
      .split(/(?<=[.!?])\s+(?=[A-Z“"'(])/)
      .map(p => p.trim())
      .filter(p => p.length > 20)
      .slice(0, 20);

    const html = paragraphs.length
      ? paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")
      : `<p>${escapeHtml(raw.slice(0, 400))}</p>`;

    return {
      id: "s" + i,
      title: h.title,
      type: "auto",     // let render.js detect the type
      page: h.page,
      pages: h.endPage && h.endPage !== h.page ? `${h.page}–${h.endPage}` : String(h.page),
      text: html,
      hidden: false
    };
  });
}

// ============================================================
// PREVIEW / PUBLISH / LIST / SITE — unchanged from before
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

  await pub.set({
    ...s,
    slug,
    ownerId: uid,
    visibility: "public",
    status: "published",
    updatedAt: FV.serverTimestamp()
  }, { merge: true });

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
    try {
      const pub = await db.doc(`publicWebsites/${s.id}`).get();
      views[s.id] = pub.data()?.views || 0;
    } catch { views[s.id] = 0; }
  }));

  return {
    sites: sites
      .map(s => ({ ...s, views: views[s.id] ?? s.views ?? 0 }))
      .sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() ?? 0;
        const tb = b.updatedAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
  };
});

exports.site = onRequest(async (q, res) => {
  const slug = decodeURIComponent(q.path.split("/").filter(Boolean).pop() || "");
  const s = await db.collection("publicWebsites").where("slug", "==", slug).limit(1).get();
  if (s.empty) return res.status(404).send("<h1>Website not found</h1>");
  await s.docs[0].ref.update({ views: FV.increment(1) });
  res
    .set("Cache-Control", "public,max-age=60")
    .send(render(s.docs[0].data(), { url: `https://${q.get("host")}/webify/${slug}` }));
});

// ============================================================
// HELPERS
// ============================================================
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function cleanMetaTitle(t) {
  if (!t) return "";
  const s = String(t).trim();
  if (["Not detected", "(anonymous)", "anonymous", "untitled", ""].includes(s.toLowerCase())) return "";
  if (s.length < 3) return "";
  return s;
}