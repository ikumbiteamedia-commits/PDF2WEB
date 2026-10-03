// functions/index.js
const{onObjectFinalized}=require("firebase-functions/v2/storage"),{onCall,onRequest,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore(),FV=admin.firestore.FieldValue,TS=admin.firestore.Timestamp;
const pdfParse=require("pdf-parse");
const FREE_PAGES=49;
const CUR=["USD","KES","UGX","TZS"],BYC={KE:"KES",UG:"UGX",TZ:"TZS",US:"USD"};
const isPrem=async u=>{const d=(await db.doc(`users/${u}`).get()).data();return d?.plan==="premium"&&d.subscriptionStatus==="active"&&d.subscriptionExpiresAt?.toMillis()>Date.now()};
const need=r=>{if(!r.auth)throw new HttpsError("unauthenticated","Sign in required");return r.auth.uid};

// ============================================================
// PROCESS DOCUMENT — extracts text, headings, builds search index
// ============================================================
exports.processDocument=onObjectFinalized({region:"us-east1",memory:"2GiB",timeoutSeconds:540},async ev=>{
  console.log("processDocument: fired", {name: ev.data.name, bucket: ev.data.bucket});

  const m = ev.data.name.match(/^users\/([^/]+)\/documents\/([^/]+)\/original\.pdf$/);
  if(!m){
    console.log("processDocument: path doesn't match — ignoring");
    return;
  }

  const [, uid, docId] = m;
  const ref = db.doc(`users/${uid}/documents/${docId}`);
  console.log("processDocument: looking for firestore doc", {uid, docId});

  // Wait up to 60s for the Firestore doc to appear (client creates it after upload)
  let exists = false;
  for(let i = 0; i < 30; i++){
    const snap = await ref.get();
    if(snap.exists){ exists = true; break; }
    await new Promise(r => setTimeout(r, 2000));
  }

  if(!exists){
    console.log("processDocument: firestore doc never appeared after 60s — creating a stub");
    try {
      await ref.set({
        displayName: "Untitled PDF",
        storagePath: ev.data.name,
        status: "uploaded",
        createdAt: FV.serverTimestamp(),
        stub: true
      }, {merge: true});
    } catch(e){
      console.error("processDocument: couldn't create stub", e);
      return;
    }
  }

  try{
    await ref.update({status:"processing", stage:"extracting", progress:0});
    console.log("processDocument: downloading file");

    const [buf] = await admin.storage().bucket(ev.data.bucket).file(ev.data.name).download();
    console.log("processDocument: downloaded", {bytes: buf.length});

    const parsed = await pdfParse(buf);
    const rawText = parsed.text || "";
    const pages = rawText.split("\f");
    const n = pages.length || parsed.numpages || 1;
    console.log("processDocument: parsed", {pages: n, chars: rawText.length});

    let toc = [], empty = 0, b = db.batch(), c = 0;
    for(let p = 1; p <= n; p++){
      const text = (pages[p-1]||"").replace(/\s+/g," ").trim();
      if(text.length < 20) empty++;
      const lineArr = (pages[p-1]||"").split("\n");
      for(const raw of lineArr){
        const s = raw.trim();
        if(s.length < 3 || s.length > 80) continue;
        const num = /^(\d+(?:\.\d+){0,3})[.)]?\s+\S/.exec(s);
        const caps = s === s.toUpperCase() && /[A-Z]{3}/.test(s);
        if(num || caps) toc.push({
          title: s.replace(/^\d+(?:\.\d+)*[.)]?\s+/,"").replace(/\s+/g," "),
          page: p,
          level: num ? num[1].split(".").length - 1 : 0,
          confidence: num ? .9 : .6
        });
      }
      b.set(ref.collection("pages").doc(String(p)), {
        text,
        terms: [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 600)
      });
      if(++c >= 400){ await b.commit(); b = db.batch(); c = 0; }
      if(p % 25 === 0) await ref.update({progress: Math.round(p / n * 100), pages: n});
    }
    await b.commit();

    const seen = {};
    toc.forEach(h => seen[h.title] = (seen[h.title] || 0) + 1);
    toc = toc.filter(h => seen[h.title] <= Math.max(3, n * .03)).slice(0, 800);

    await ref.update({
      status: "ready",
      stage: "complete",
      progress: 100,
      pages: n,
      toc,
      meta: {
        title: parsed.info?.Title || "Not detected",
        author: parsed.info?.Author || "Not detected"
      },
      note: empty > n/2 ? "Most pages have no text layer. OCR is not available yet." : FV.delete()
    });

    console.log("processDocument: DONE — status set to ready", {docId, pages: n, tocCount: toc.length});
  }catch(e){
    console.error("processDocument: FAILED", e);
    await ref.update({status:"failed", error:String(e.message || e).slice(0,200)}).catch(()=>{});
  }
});

// ============================================================
// SEARCH
// ============================================================
exports.searchDocs=onCall({memory:"512MiB"},async req=>{
  // Multi-word search (AND with partial-match feedback). Words >= 2 chars, case-insensitive SUBSTRING match.
  // Full matches first, then partial; each group sorted by page number.
  const uid=need(req),q=String(req.data.q||"").trim().toLowerCase().slice(0,100);if(!q)return{results:[]};
  const prem=await isPrem(uid),col=db.collection(`users/${uid}/documents`),out=[],num=q.match(/^(?:p(?:age)?\.?\s*)?(\d{1,6})$/);
  const docs=req.data.docId?[await col.doc(req.data.docId).get()]:(await col.where("status","==","ready").get()).docs;
  const words=[...new Set(q.split(/\s+/).filter(w=>w.length>=2))].slice(0,10);
  for(const d of docs.filter(x=>x.exists)){const D=d.data(),toc=D.toc||[];
    if(num){const p=+num[1];if(p>=1&&p<=D.pages)out.push({docId:d.id,docName:D.displayName,page:p,heading:"Page "+p,score:1,full:true,matched:[],missing:[],total:0,locked:!prem&&p>FREE_PAGES});continue}
    if(!words.length)continue;
    // substring semantics need the page text itself (the 'terms' index only holds whole tokens)
    for(const s of(await d.ref.collection("pages").limit(2000).get()).docs){
      const t=s.data().text||"",l=t.toLowerCase();
      const matched=words.filter(w=>l.includes(w)),missing=words.filter(w=>!l.includes(w));
      if(!matched.length)continue;
      const full=!missing.length,p=+s.id,ph=l.indexOf(q);
      const first=matched.map(w=>l.indexOf(w)).sort((a,b)=>a-b)[0],i=ph>-1?ph:first;
      const h=[...toc].reverse().find(x=>x.page<=p),lk=!prem&&p>FREE_PAGES;
      out.push({docId:d.id,docName:D.displayName,page:p,heading:h?.title||"",locked:lk,
        snippet:lk?null:t.slice(Math.max(0,i-70),i+(ph>-1?q.length:matched[0].length)+110),
        full,matched,missing,total:words.length,
        warning:full?null:`Found ${matched.length} of ${words.length} words on this page: matched ${matched.map(w=>"'"+w+"'").join(", ")}. Missing: ${missing.map(w=>"'"+w+"'").join(", ")}.`,
        score:(ph>-1?4:0)+matched.length})}}
  out.sort((a,b)=>(b.full-a.full)||(a.full?0:b.matched.length-a.matched.length)||(a.docName||"").localeCompare(b.docName||"")||(a.page-b.page));
  return{results:out.slice(0,40)}});

// ============================================================
// PRICING — plans in USD + live FX rates for local currency display
// ============================================================
const PLAN_USD={weekly:20,monthly:40};

// Fallback rates (only used if all live sources fail)
const FALLBACK_RATES = { USD: 1, KES: 129, UGX: 3800, TZS: 2600 };

async function getRates(){
  const ref=db.doc("exchangeRates/USD");
  const cached=(await ref.get()).data();

  // Return cached if fresh (< 6 hours old) AND has more than just USD
  if(cached && Date.now()-cached.timestamp < 6*3600*1000
     && cached.rates && Object.keys(cached.rates).length > 1){
    return cached.rates;
  }

  // Try multiple rate sources in order
  const sources = [
    { name: "open.er-api.com",     url: "https://open.er-api.com/v6/latest/USD",                pick: j => j?.rates },
    { name: "exchangerate-api.com",url: "https://api.exchangerate-api.com/v4/latest/USD",        pick: j => j?.rates },
    { name: "frankfurter.app",     url: "https://api.frankfurter.app/latest?from=USD",           pick: j => j?.rates }
  ];

  for(const src of sources){
    try{
      const resp = await fetch(src.url);
      if(!resp.ok) continue;
      const j = await resp.json();
      const all = src.pick(j) || {};
      const keep = { USD: 1 };
      for(const c of CUR) if(all[c]) keep[c] = all[c];

      if(Object.keys(keep).length > 1){
        await ref.set({
          baseCurrency:"USD",
          rates: keep,
          timestamp: Date.now(),
          source: src.name
        });
        console.log(`getRates: success from ${src.name}`, keep);
        return keep;
      }
    }catch(e){
      console.warn(`getRates: ${src.name} failed —`, e.message);
    }
  }

  console.warn("getRates: all sources failed, using fallback rates");
  await ref.set({
    baseCurrency:"USD",
    rates: FALLBACK_RATES,
    timestamp: Date.now(),
    source: "fallback"
  });
  return FALLBACK_RATES;
}

exports.getPricing=onCall(async req=>{
  const h=req.rawRequest?.headers||{};

  // 1) Cloud Functions header (rarely populated on v2)
  const headerCountry=(h["x-appengine-country"]||h["cf-ipcountry"]||h["x-country-code"]||"").toUpperCase();

  // 2) Client-supplied country (from guessCountry() in pricing.js)
  const clientCountry=String(req.data?.country||"").toUpperCase();

  // 3) Locale fallback (e.g. "en-KE" → "KE")
  const localeCountry=(String(req.data?.locale||"").match(/-([A-Z]{2})$/)||[])[1]||"";

  const country=headerCountry||clientCountry||localeCountry||"";
  const autoCurrency=BYC[country]||"USD";

  const requested=String(req.data?.currency||"").toUpperCase();
  const currency=CUR.includes(requested)?requested:autoCurrency;

  const rates=await getRates();

  const plans=Object.entries(PLAN_USD).map(([id,usd])=>({
    id,
    label:id.charAt(0).toUpperCase()+id.slice(1),
    usd,
    local:currency==="USD"?usd:Math.ceil(usd*(rates[currency]||1))
  }));

  return { country, currency, rates, plans };
});

// ============================================================
// SIMULATED PAYMENT — no gateway. Flips account to premium immediately.
// ============================================================
const PLAN_DAYS={weekly:7,monthly:30};

exports.simulatePayment=onCall(async req=>{
  const uid=need(req);
  const plan=String(req.data?.plan||"").toLowerCase();
  if(!PLAN_DAYS[plan])throw new HttpsError("invalid-argument","Unknown plan");
  const days=PLAN_DAYS[plan],usd=PLAN_USD[plan];
  const userRef=db.doc(`users/${uid}`);
  const current=(await userRef.get()).data()||{};
  const base=Math.max(Date.now(),current.subscriptionExpiresAt?.toMillis?.()??0);
  const expires=TS.fromMillis(base+days*86400*1000);

  await userRef.set({
    plan:"premium",
    subscriptionStatus:"active",
    subscriptionPlan:plan,
    subscriptionStartedAt:FV.serverTimestamp(),
    subscriptionExpiresAt:expires,
    paymentProvider:"simulated",
    lastTransactionUSD:usd,
    lastTransactionAt:FV.serverTimestamp()
  },{merge:true});

  await db.collection(`users/${uid}/payments`).add({
    plan,usd,currency:"USD",status:"paid",provider:"simulated",paidAt:FV.serverTimestamp()
  });

  await db.collection("auditLogs").add({
    type:"simulated_payment",uid,meta:{plan,usd},ts:FV.serverTimestamp()
  });

  return{ok:true,plan,expiresAt:expires.toMillis()};
});

// ---- Legacy stubs ----
exports.startPayment=onCall(async()=>{throw new HttpsError("unimplemented","Use simulatePayment instead")});
exports.flutterwaveWebhook=onRequest((req,res)=>res.status(501).send("Not configured"));

// ---- Webify, Tools, Admin ----
Object.assign(exports,require("./webify"),require("./tools"),require("./admin"));