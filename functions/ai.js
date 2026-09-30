// functions/ai.js
// Gemini wrapper — designs a website from a PDF's table of contents.
// Uses Firebase AI Logic (Vertex AI) via the Cloud Function's service account.
// No API keys, no browser-side calls, no third-party accounts.

const { VertexAI } = require("@google-cloud/vertexai");

const PROJECT = process.env.GCLOUD_PROJECT || "pdf2web-8b229";
const LOCATION = "us-central1";
const MODEL = "gemini-2.5-flash";

// ============================================================
// THE PROMPT
// ============================================================
// The AI designs the information architecture of the site:
//   - Site title, subtitle, hero copy, CTA copy
//   - What sections exist (grouped, renamed, de-duplicated)
//   - What "type" each section is (prose / specs / bullets / stats / quote / feature / cta)
//
// The AI does NOT write body text. Body comes verbatim from the PDF.
// This prevents hallucination of factual content.

const SYSTEM_PROMPT = `You are a document architect. You take a PDF's structure (a list of headings from the document) and design the information architecture of a clean, professional website that presents the document.

You MUST return strict JSON matching the schema below. No prose, no markdown, no explanation.

Schema:
{
  "title": "string — the site's main title (the document's real subject, not the filename)",
  "subtitle": "string — one short line under the title",
  "heroText": "string — 1-2 sentences describing what this document is",
  "docType": "manual | catalogue | report | profile | guide | contract | other",
  "sections": [
    {
      "sourceIndex": 0,
      "title": "string — the section title (rename to be cleaner if needed)",
      "type": "prose | specs | bullets | feature | stats | quote | cta",
      "summary": "string — one sentence describing what this section covers"
    }
  ],
  "ctaTitle": "string — a call-to-action heading for the bottom of the site",
  "ctaText": "string — one sentence supporting the CTA"
}

Rules:
1. Return 3-10 sections. Merge related headings. Drop headings that are just page numbers, headers, or duplicates.
2. Section titles must be clean: title case, no "Page 3 of 9", no numbered prefixes like "1.2.3".
3. Choose "type" based on what the section contains:
   - "specs" for specifications, dimensions, technical data
   - "bullets" for lists, procedures, steps, checklists
   - "stats" for numeric highlights (weight, capacity, measurements)
   - "quote" for stand-alone statements
   - "feature" for short sections (1-2 paragraphs)
   - "cta" for contact / get-in-touch / book-now content
   - "prose" for everything else
4. "sourceIndex" refers to the index of the heading in the input list. This is how we link sections back to real PDF text.
5. Do NOT invent content. Only reference what's in the input.
6. The CTA is generic ("Learn more", "Get in touch", etc.) — don't invent contact details.

Return ONLY the JSON object. No surrounding text.`;

// ============================================================
// BUILD THE USER PROMPT
// ============================================================
function buildUserPrompt(doc, samples) {
  const headingList = (doc.toc || [])
    .slice(0, 60)
    .map((h, i) => `[${i}] "${h.title}" (level ${h.level ?? 0}, page ${h.page})`)
    .join("\n");

  const pageSample = (samples || [])
    .map((p, i) => `--- Sample page ${i + 1} (page ${p.page}) ---\n${(p.text || "").slice(0, 800)}`)
    .join("\n\n");

  return `Document filename: ${doc.displayName || "untitled.pdf"}
Detected pages: ${doc.pages || "unknown"}

Headings found by the extractor:
${headingList || "(none detected — treat the document as a single-section guide)"}

Sample page content (for context only — DO NOT copy this into the JSON):
${pageSample || "(no sample available)"}

Design a website structure for this document following the schema. Return ONLY the JSON.`;
}

// ============================================================
// MAIN — call Gemini
// ============================================================
async function analyzeDocument(doc, samples) {
  const vertex = new VertexAI({ project: PROJECT, location: LOCATION });
  const model = vertex.getGenerativeModel({
    model: MODEL,
    systemInstruction: {
      role: "system",
      parts: [{ text: SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const prompt = buildUserPrompt(doc, samples);
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");

  // Parse the JSON. It should be clean because we set responseMimeType.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Fallback: try to extract JSON from a possible code fence
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Gemini returned non-JSON: " + text.slice(0, 200));
    parsed = JSON.parse(m[0]);
  }

  return validateAndNormalize(parsed, doc);
}

// ============================================================
// VALIDATE — no hallucinated sections, clean structure
// ============================================================
function validateAndNormalize(ai, doc) {
  const toc = doc.toc || [];
  const sourceTitles = toc.map(h => String(h.title || "").toLowerCase().trim());

  // 1. Clamp title / subtitle / heroText
  const out = {
    title: clean(ai.title, 120) || doc.displayName || "Document",
    subtitle: clean(ai.subtitle, 200) || "",
    heroText: clean(ai.heroText, 400) || `Generated from ${doc.displayName || "your document"}.`,
    docType: ["manual","catalogue","report","profile","guide","contract","other"]
      .includes(ai.docType) ? ai.docType : "other",
    sections: [],
    ctaTitle: clean(ai.ctaTitle, 80) || "Ready to learn more?",
    ctaText: clean(ai.ctaText, 240) || "Explore the original document for full details.",
  };

  // 2. Sections must reference real source headings
  const seen = new Set();
  for (const s of (ai.sections || [])) {
    if (out.sections.length >= 10) break;

    const srcIdx = Number.isInteger(s.sourceIndex) ? s.sourceIndex : null;
    if (srcIdx === null || srcIdx < 0 || srcIdx >= toc.length) continue;

    const srcTitle = String(toc[srcIdx].title || "").toLowerCase().trim();
    if (!srcTitle) continue;
    if (seen.has(srcTitle)) continue;
    seen.add(srcTitle);

    const title = clean(s.title, 80) || toc[srcIdx].title;
    const type = ["prose","specs","bullets","feature","stats","quote","cta"]
      .includes(s.type) ? s.type : "prose";

    out.sections.push({
      sourceIndex: srcIdx,
      title,
      type,
      summary: clean(s.summary, 240) || "",
    });
  }

  // 3. If AI returned nothing usable, fall back to a naive structure
  if (out.sections.length === 0) {
    out.sections = toc.slice(0, 8).map((h, i) => ({
      sourceIndex: i,
      title: h.title || `Section ${i + 1}`,
      type: "prose",
      summary: "",
    }));
  }

  return out;
}

function clean(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

// ============================================================
// EXPORTS
// ============================================================
exports.analyzeDocument = analyzeDocument;