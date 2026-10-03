// functions/ai.js
// Gemini (Vertex AI via the function's service account — no API keys) designs the FULL site:
//   Phase 1  analyzeDocument()   -> hero, 8-15 typed sections (with merged headings), CTA, footer
//   Phase 2  structureSections() -> each section's text parsed into semantic chunks for its type
//
// Rules the prompts enforce: never invent content, never drop headings (rename / merge only),
// copy wording from the PDF verbatim. Every AI answer is validated; anything that fails validation
// falls back to a deterministic parser so a bad model response can never lose or invent content.

const { VertexAI } = require("@google-cloud/vertexai");
const { FA_ICONS } = require("./render");

const PROJECT = process.env.GCLOUD_PROJECT || "pdf2web-8b229";
const LOCATION = "us-central1";
const MODEL = "gemini-2.5-flash";

const SECTION_TYPES = ["prose", "specs", "bullets", "stats", "quote", "feature", "cta", "gallery", "timeline", "table", "comparison"];
const DOC_TYPES = ["manual", "catalogue", "report", "profile", "guide", "contract", "other"];
const MAX_SECTIONS = 15;
const MIN_SECTIONS = 8;

// ============================================================
// LOW-LEVEL: one JSON call to Gemini
// ============================================================
async function callJSON(systemPrompt, userPrompt, { maxOutputTokens = 16384, temperature = 0.2 } = {}) {
  const vertex = new VertexAI({ project: PROJECT, location: LOCATION });
  const model = vertex.getGenerativeModel({
    model: MODEL,
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json" },
  });
  const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: userPrompt }] }] });
  const parts = result?.response?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || "").join("");
  if (!text) throw new Error("Empty response from Gemini");
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Gemini returned non-JSON: " + text.slice(0, 200));
    return JSON.parse(m[0]);
  }
}

// ============================================================
// PHASE 1 — SITE DESIGN
// ============================================================
const DESIGN_PROMPT = `You are a senior web designer and information architect. You receive a PDF's heading list (each with an index), a short excerpt of the text under each heading, and a few sample pages. You design a complete, professional, persuasive website that presents the document. You never invent facts.

Return STRICT JSON only (no prose, no markdown) matching:
{
  "title": "string — the real subject of the document (not the filename)",
  "subtitle": "string — one short line",
  "heroText": "string — 1-2 sentences describing what the document is",
  "docType": "manual | catalogue | report | profile | guide | contract | other",
  "hero": {
    "kicker": "string — 1-3 words, e.g. 'Service Manual'",
    "heading": "string — large headline (usually the title)",
    "subheading": "string — one supporting sentence",
    "primaryCtaText": "string — e.g. 'Start reading'",
    "secondaryCtaText": "string — e.g. 'Get in touch'"
  },
  "sections": [
    {
      "sourceIndex": 0,
      "mergedIndexes": [],
      "title": "string — clean title case, no numbering",
      "type": "prose | specs | bullets | stats | quote | feature | cta | gallery | timeline | table | comparison",
      "summary": "string — ONE sentence",
      "icon": "string — a Font Awesome FREE solid icon class like fa-gears"
    }
  ],
  "cta": { "heading": "string", "text": "string", "buttonText": "string" },
  "footer": { "tagline": "string", "columns": [ { "heading": "About", "links": ["string"] }, { "heading": "Quick links", "links": ["section title", "..."] }, { "heading": "Contact", "links": [] } ] }
}

Rules:
1. Return between ${MIN_SECTIONS} and ${MAX_SECTIONS} sections. If the document has fewer headings than that, return one section per heading.
2. NEVER DROP CONTENT. Every meaningful heading in the list must appear in the output: either as a section's "sourceIndex" or inside a section's "mergedIndexes" (merge related headings into one section). You may rename and merge, but not omit. Headings that are only page numbers, running headers or obvious noise may be ignored.
3. "sourceIndex" and every entry in "mergedIndexes" are the [index] numbers from the heading list. Keep sections in document order.
4. Pick "type" from what the excerpt actually contains: specs (label/value pairs), bullets (lists, steps, checklists), stats (headline numbers), quote (a stand-alone statement), feature (one short callout), timeline (dated or ordered events/phases), table (rows and columns), comparison (two things contrasted), gallery (figures/photos/images), cta (contact / get in touch), prose (everything else). Use a variety of types, but only where the content fits.
5. "icon" must be a real Font Awesome free-solid icon name starting with "fa-".
6. Do not invent contact details, prices, names or claims. CTA copy must be generic ("Get in touch", "Learn more").
7. footer.columns: exactly three — About, Quick links (up to 6 section titles that exist in your sections), Contact (leave links empty).
Return ONLY the JSON object.`;

const STRICT_ADDENDUM = `

STRICT MODE — your previous answer returned too few sections. This document has many headings. You MUST return between ${MIN_SECTIONS} and ${MAX_SECTIONS} sections, and EVERY heading from the list must be covered by a section's sourceIndex or mergedIndexes. Do not summarise the whole document into a few sections.`;

function buildDesignPrompt(doc, ctx) {
  const headings = (ctx.headings || [])
    .map(h => `[${h.idx}] "${h.title}" (level ${h.level}, page ${h.page})${h.excerpt ? ` — ${JSON.stringify(h.excerpt)}` : ""}`)
    .join("\n");
  const samples = (ctx.samples || [])
    .map((p, i) => `--- Sample page ${i + 1} (page ${p.page}) ---\n${(p.text || "").slice(0, 1200)}`)
    .join("\n\n");
  const front = ctx.frontMatter ? `\nText before the first heading (cover / intro):\n${ctx.frontMatter.slice(0, 700)}\n` : "";
  return `Document filename: ${doc.displayName || "untitled.pdf"}
Pages: ${doc.pages || "unknown"}
Embedded title: ${doc.meta?.title || "n/a"}
${front}
Headings (index, title, level, page, excerpt):
${headings || "(none detected — treat the document as one guide and split it by topic using the sample pages; use sourceIndex -1 only if no headings exist)"}

Sample pages (context only — do not copy):
${samples || "(none)"}

Design the website. Return ONLY the JSON.`;
}

async function analyzeDocument(doc, ctx = {}, opts = {}) {
  const ctxObj = Array.isArray(ctx) ? { samples: ctx, headings: legacyHeadings(doc) } : ctx;
  const headings = ctxObj.headings || [];
  const validIdx = new Set(headings.map(h => h.idx));

  const run = async (strict) => {
    const raw = await callJSON(
      DESIGN_PROMPT + (strict ? STRICT_ADDENDUM : ""),
      buildDesignPrompt(doc, ctxObj),
      { maxOutputTokens: 24576, temperature: strict ? 0.1 : 0.2 }
    );
    return validateDesign(raw, doc, headings, validIdx);
  };

  let design = await run(!!opts.strict);

  // Many headings but the model collapsed everything -> retry ONCE with a stricter instruction
  if (!opts.strict && headings.length >= 10 && design.sections.length < 5) {
    console.warn("ai: only", design.sections.length, "sections for", headings.length, "headings — retrying strict");
    try {
      const again = await run(true);
      if (again.sections.length > design.sections.length) design = again;
    } catch (e) { console.warn("ai: strict retry failed:", e.message); }
  }
  return design;
}

function legacyHeadings(doc) {
  return (doc.toc || []).slice(0, 60).map((h, i) => ({ idx: i, title: h.title, level: h.level ?? 0, page: h.page, excerpt: "" }));
}

// ============================================================
// VALIDATION (design)
// ============================================================
const clean = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanTitle = (s, max = 90) =>
  clean(s, max + 20).replace(/^\s*(?:section|chapter|part)?\s*\d+(?:\.\d+)*[.):\-–]?\s+/i, "").replace(/\s*\.{3,}\s*\d*$/, "").trim().slice(0, max);

function validateDesign(ai, doc, headings, validIdx) {
  const title = clean(ai.title, 120) || doc.displayName || "Document";
  const subtitle = clean(ai.subtitle, 200) || clean(ai.hero?.subheading, 200);
  const heroText = clean(ai.heroText, 400) || `Generated from ${doc.displayName || "your document"}.`;

  const hero = {
    kicker: clean(ai.hero?.kicker, 40) || (DOC_TYPES.includes(ai.docType) && ai.docType !== "other" ? ai.docType : "Document"),
    heading: clean(ai.hero?.heading, 120) || title,
    subheading: clean(ai.hero?.subheading, 220) || subtitle || heroText,
    primaryCtaText: clean(ai.hero?.primaryCtaText, 30) || "Start reading",
    secondaryCtaText: clean(ai.hero?.secondaryCtaText, 30) || "Get in touch",
  };

  const used = new Set();
  const sections = [];
  for (const s of (Array.isArray(ai.sections) ? ai.sections : [])) {
    if (sections.length >= MAX_SECTIONS) break;
    const src = Number.isInteger(s.sourceIndex) ? s.sourceIndex : null;
    if (src === null || !validIdx.has(src) || used.has(src)) continue;
    used.add(src);

    const merged = [];
    for (const m of (Array.isArray(s.mergedIndexes) ? s.mergedIndexes : [])) {
      if (Number.isInteger(m) && validIdx.has(m) && !used.has(m)) { used.add(m); merged.push(m); }
    }
    const head = headings.find(h => h.idx === src);
    sections.push({
      sourceIndex: src,
      mergedIndexes: merged,
      title: cleanTitle(s.title) || cleanTitle(head?.title) || `Section ${sections.length + 1}`,
      type: SECTION_TYPES.includes(s.type) ? s.type : "prose",
      summary: clean(s.summary, 240),
      icon: typeof s.icon === "string" && FA_ICONS.has(s.icon.trim()) ? s.icon.trim() : "",
    });
  }

  const cta = {
    heading: clean(ai.cta?.heading, 90) || clean(ai.ctaTitle, 90) || "Ready to learn more?",
    text: clean(ai.cta?.text, 240) || clean(ai.ctaText, 240) || "Explore the full document or get in touch.",
    buttonText: clean(ai.cta?.buttonText, 30) || "Get in touch",
  };

  const columns = (Array.isArray(ai.footer?.columns) ? ai.footer.columns : []).slice(0, 3).map(c => ({
    heading: clean(c?.heading, 30),
    links: (Array.isArray(c?.links) ? c.links : []).slice(0, 8).map(l => clean(typeof l === "string" ? l : l?.label, 40)).filter(Boolean),
  })).filter(c => c.heading);

  return {
    title, subtitle, heroText,
    docType: DOC_TYPES.includes(ai.docType) ? ai.docType : "other",
    hero, sections, cta,
    footer: { tagline: clean(ai.footer?.tagline, 160) || subtitle || heroText.slice(0, 160), columns },
  };
}

// ============================================================
// PHASE 2 — STRUCTURE EACH SECTION'S TEXT
// ============================================================
const STRUCTURE_PROMPT = `You convert the extracted text of ONE section of a PDF into structured website content. The text has lost its line breaks.

ABSOLUTE RULES
- Copy the document's own wording VERBATIM. Do not summarise, paraphrase, translate, correct or invent anything.
- Do not drop content. Anything that does not fit the typed body goes into "extra" (an array of verbatim paragraphs).
- Remove only obvious page furniture (running headers/footers, lone page numbers).

Return STRICT JSON: { "type": "<type>", "body": <shape>, "extra": [ "paragraph", ... ] }

Body shape by type (you may change the proposed type if it clearly does not fit; prose is always safe):
- prose:      body = [ "paragraph", ... ]            (split into natural paragraphs)
- specs:      body = [ { "label": "...", "value": "..." }, ... ]
- bullets:    body = [ "item", ... ]
- stats:      body = [ { "value": "250 kW", "label": "Peak power" }, ... ]   (max 6; value is the number with its unit exactly as written)
- quote:      body = { "text": "...", "cite": "" }
- feature:    body = { "heading": "...", "text": "..." }   (short callout; heading is a short phrase taken from the text)
- timeline:   body = [ { "label": "2019 / Step 1 / Phase A", "text": "..." }, ... ]
- table:      body = { "headers": ["..."], "rows": [ ["..."], ... ] }
- comparison: body = { "left": { "title": "...", "items": ["..."] }, "right": { "title": "...", "items": ["..."] } }
- gallery:    body = [ { "src": "", "caption": "figure caption if the text has one" } ]   (no image URLs ever)
- cta:        body = { "text": "...", "buttonText": "Get in touch" }`;

async function structureOne(sec, deadline) {
  const text = sec.text || "";
  if (!text.trim()) return { type: sec.type, body: fallbackBody(sec.type, "").body, extra: [] , method: "empty" };
  if (Date.now() > deadline) return { ...fallbackStructure(sec.type, text), method: "fallback-deadline" };

  // Keep the model call bounded; the remainder is parsed deterministically so nothing is lost.
  const LIMIT = 9000;
  let head = text, tail = "";
  if (text.length > LIMIT) {
    let cut = text.lastIndexOf(". ", LIMIT);
    if (cut < LIMIT * 0.6) cut = LIMIT;
    head = text.slice(0, cut + 1); tail = text.slice(cut + 1).trim();
  }

  try {
    const raw = await callJSON(
      STRUCTURE_PROMPT,
      `Section title: ${sec.title}\nProposed type: ${sec.type}\n\nText:\n"""${head}"""\n\nReturn ONLY the JSON.`,
      { maxOutputTokens: 12288, temperature: 0.1 }
    );
    const type = SECTION_TYPES.includes(raw.type) ? raw.type : sec.type;
    const norm = normalizeBody(type, raw.body);
    const extra = (Array.isArray(raw.extra) ? raw.extra : []).map(x => clean(String(x), 4000)).filter(Boolean);
    if (norm !== null) {
      // coverage guard: the model must have kept (almost) all the words, and not invented many new ones
      const kept = alnumLen(JSON.stringify(norm)) + alnumLen(extra.join(" "));
      const want = alnumLen(head);
      if (want === 0 || (kept >= want * 0.8 && kept <= want * 1.5)) {
        if (tail) extra.push(...toParagraphs(tail));
        return { type, body: norm, extra, method: "ai" };
      }
      console.warn(`structure: coverage ${kept}/${want} for "${sec.title}" — using deterministic parser`);
    }
  } catch (e) {
    console.warn(`structure: AI failed for "${sec.title}":`, e.message);
  }
  return { ...fallbackStructure(sec.type, text), method: "fallback" };
}

/**
 * @param {Array<{id:string,title:string,type:string,text:string}>} items
 * @returns {Promise<Array<{type,body,extra,method}>>} same order as items
 */
async function structureSections(items, { concurrency = 4, budgetMs = 170000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await structureOne(items[i], deadline);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

// ============================================================
// BODY NORMALISATION (strict shape checks)
// ============================================================
const strs = a => (Array.isArray(a) ? a : []).map(x => clean(String(x ?? ""), 4000)).filter(Boolean);
const alnumLen = s => (String(s).match(/[A-Za-z0-9\u00C0-\uFFFF]/g) || []).length;

function normalizeBody(type, body) {
  try {
    switch (type) {
      case "prose": case "bullets": {
        const a = strs(body); return a.length ? a : null;
      }
      case "specs": {
        const a = (Array.isArray(body) ? body : []).map(r => ({ label: clean(r?.label, 80), value: clean(String(r?.value ?? ""), 400) })).filter(r => r.label && r.value);
        return a.length >= 2 ? a : null;
      }
      case "stats": {
        const a = (Array.isArray(body) ? body : []).map(r => ({ value: clean(String(r?.value ?? ""), 24), label: clean(r?.label, 60) })).filter(r => r.value).slice(0, 6);
        return a.length >= 2 ? a : null;
      }
      case "quote": {
        const t = clean(typeof body === "string" ? body : body?.text, 700);
        return t ? { text: t, cite: clean(body?.cite, 80) } : null;
      }
      case "feature": {
        const t = clean(typeof body === "string" ? body : body?.text, 900);
        return t ? { heading: clean(body?.heading, 90), text: t } : null;
      }
      case "timeline": {
        const a = (Array.isArray(body) ? body : []).map(r => ({ label: clean(r?.label, 60), text: clean(String(r?.text ?? ""), 600) })).filter(r => r.label || r.text);
        return a.length >= 2 ? a : null;
      }
      case "table": {
        const headers = strs(body?.headers).slice(0, 12);
        const rows = (Array.isArray(body?.rows) ? body.rows : []).map(r => (Array.isArray(r) ? r : []).map(c => clean(String(c ?? ""), 200))).filter(r => r.some(Boolean)).slice(0, 200);
        return rows.length >= 2 ? { headers, rows } : null;
      }
      case "comparison": {
        const side = x => ({ title: clean(x?.title, 80), items: strs(x?.items).slice(0, 14) });
        const l = side(body?.left), r = side(body?.right);
        return l.items.length && r.items.length ? { left: l, right: r } : null;
      }
      case "gallery": {
        const a = (Array.isArray(body) ? body : []).map(x => ({ src: "", caption: clean(x?.caption, 160) })).slice(0, 12);
        return a;   // empty list is fine: the editor adds images
      }
      case "cta": {
        const t = clean(typeof body === "string" ? body : body?.text, 300);
        return t ? { text: t, buttonText: clean(body?.buttonText, 30) || "Get in touch" } : null;
      }
      default: return null;
    }
  } catch { return null; }
}

// ============================================================
// DETERMINISTIC PARSER (fallback when AI is unavailable or fails validation)
// ============================================================
function toParagraphs(text) {
  const sentences = String(text || "").replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(\[])/).map(s => s.trim()).filter(Boolean);
  const out = []; let cur = "";
  for (const s of sentences) {
    if (cur && (cur.length + s.length > 520)) { out.push(cur); cur = s; }
    else cur = cur ? cur + " " + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

function fallbackBody(type, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return { type: "prose", body: [] };
  return fallbackStructure(type, t);
}

function fallbackStructure(type, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const prose = () => ({ type: "prose", body: toParagraphs(t), extra: [] });
  if (!t) return { type: "prose", body: [], extra: [] };

  switch (type) {
    case "specs": {
      const re = /(?:^|\s)([A-Z][A-Za-z0-9 \/&()\-]{1,38}?)\s*[:=]\s*([^:=]{1,140}?)(?=\s+[A-Z][A-Za-z0-9 \/&()\-]{1,38}?\s*[:=]|$)/g;
      const rows = []; let m;
      while ((m = re.exec(t))) rows.push({ label: m[1].trim(), value: m[2].trim() });
      return rows.length >= 3 ? { type: "specs", body: rows, extra: [] } : prose();
    }
    case "bullets": {
      let items = t.split(/\s*[•·▪◦●■]\s*/).map(s => s.trim()).filter(s => s.length > 3);
      if (items.length < 3) items = t.split(/\s+(?=\d{1,2}[.)]\s+[A-Z])/).map(s => s.replace(/^\d{1,2}[.)]\s+/, "").trim()).filter(s => s.length > 3);
      if (items.length < 3) items = t.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 8);
      return items.length >= 3 ? { type: "bullets", body: items, extra: [] } : prose();
    }
    case "stats": {
      const re = /(\d[\d,]*(?:\.\d+)?)\s?(kg|g|lbs?|km\/h|km|mi|mm|cm|m|L|l|ml|hp|kW|W|V|A|Nm|rpm|%|°C|°F|yrs?|years|months?|days?|hours?|KES|USD|\$)\b/g;
      const seen = new Set(), items = []; let m;
      while ((m = re.exec(t)) && items.length < 6) {
        const key = m[0].toLowerCase(); if (seen.has(key)) continue; seen.add(key);
        const before = t.slice(Math.max(0, m.index - 40), m.index).split(/[.:;,]\s*/).pop().trim();
        const STOP = /^(a|an|the|of|and|with|at|to|in|is|are|was|has|have|weighs|about|up|for|by)$/i;
        const words = before.split(/\s+/).filter(w => w && !/\d/.test(w) && !STOP.test(w)).slice(-3);
        items.push({ value: m[0], label: words.join(" ") || "Value" });
      }
      return items.length >= 2 ? { type: "stats", body: items, extra: toParagraphs(t) } : prose();
    }
    case "quote": {
      const first = t.split(/(?<=[.!?])\s+/)[0] || t;
      const rest = t.slice(first.length).trim();
      return { type: "quote", body: { text: first.replace(/^["“”']|["“”']$/g, ""), cite: "" }, extra: rest ? toParagraphs(rest) : [] };
    }
    case "feature": {
      const ps = toParagraphs(t);
      const first = ps[0] || t;
      return { type: "feature", body: { heading: "", text: first }, extra: ps.slice(1) };
    }
    case "timeline": {
      const re = /\b((?:19|20)\d{2}|(?:Step|Phase|Stage|Week|Day|Month|Q[1-4])\s*\d+)\b/gi;
      const idx = []; let m;
      while ((m = re.exec(t))) idx.push({ label: m[1], at: m.index, end: m.index + m[0].length });
      if (idx.length >= 3) {
        const items = idx.map((x, i) => ({ label: x.label, text: t.slice(x.end, i + 1 < idx.length ? idx[i + 1].at : undefined).replace(/^[\s:–\-.,]+/, "").trim() })).filter(x => x.text);
        const lead = t.slice(0, idx[0].at).trim();
        if (items.length >= 3) return { type: "timeline", body: items, extra: lead.length > 40 ? toParagraphs(lead) : [] };
      }
      return prose();
    }
    case "cta": {
      const ps = toParagraphs(t);
      return { type: "cta", body: { text: (ps[0] || t).slice(0, 280), buttonText: "Get in touch" }, extra: ps.slice(1) };
    }
    case "gallery":
      return { type: "gallery", body: [], extra: toParagraphs(t) };
    default:   // prose, table, comparison -> structure is not recoverable from collapsed text
      return prose();
  }
}

module.exports = {
  analyzeDocument,
  structureSections,
  fallbackStructure,
  normalizeBody,
  toParagraphs,
  SECTION_TYPES,
  MAX_SECTIONS,
  MIN_SECTIONS,
};
