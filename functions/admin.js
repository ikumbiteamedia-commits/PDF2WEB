const{onCall}=require("firebase-functions/v2/https"),admin=require("firebase-admin"),{db,FV,audit,HttpsError}=require("./util");
const adm=r=>{if(!r.auth?.token.admin)throw new HttpsError("permission-denied","Admins only");return r.auth.uid};
exports.adminStats=onCall(async r=>{adm(r);const c=q=>q.count().get().then(s=>s.data().count),since=admin.firestore.Timestamp.fromMillis(Date.now()-30*864e5),U=db.collection("users"),D=db.collectionGroup("documents");
  const[users,premium,active,docs,failed,sites]=await Promise.all([c(U),c(U.where("plan","==","premium")),c(U.where("lastLoginAt",">=",since)),c(D),c(D.where("status","==","failed")),c(db.collection("publicWebsites"))]);
  const pages=(await D.select("pages").limit(5000).get()).docs.reduce((a,d)=>a+(d.data().pages||0),0),revenue=(await db.collectionGroup("payments").where("status","==","paid").limit(5000).get()).docs.reduce((a,d)=>a+(d.data().amountUSD||0),0);
  return{users,premium,free:users-premium,active,docs,pages,sites,failed,revenue}});
exports.adminList=onCall(async r=>{adm(r);const k=r.data.kind;let q;
  if(k==="users")q=db.collection("users").orderBy("createdAt","desc");else if(k==="documents")q=db.collectionGroup("documents").orderBy("createdAt","desc");
  else if(k==="failed")q=db.collectionGroup("documents").where("status","==","failed");else if(k==="payments")q=db.collectionGroup("payments").where("status","==","paid");else throw new HttpsError("invalid-argument","Bad kind");
  return{rows:(await q.limit(50).get()).docs.map(d=>{const x=d.data();return{path:d.ref.path,name:x.displayName||x.plan,email:x.email,plan:x.plan,status:x.status,pages:x.pages,error:x.error,disabled:!!x.disabled,uploads:x.uploadCount,amount:x.amount&&`${x.currency} ${x.amount}`,usd:x.amountUSD}})}});
exports.adminAction=onCall({memory:"1GiB",timeoutSeconds:300},async r=>{const me=adm(r),m=/^users\/([^/]+)\/documents\/([^/]+)$/.exec(String(r.data.path));if(!m)throw new HttpsError("invalid-argument","Bad path");
  const ref=db.doc(r.data.path),b=admin.storage().bucket(),pre=`users/${m[1]}/documents/${m[2]}/`;
  if(r.data.action==="delete"){await b.deleteFiles({prefix:pre});await db.recursiveDelete(ref)}
  else if(r.data.action==="disable")await ref.update({disabled:true});
  else if(r.data.action==="enable")await ref.update({disabled:false});
  else if(r.data.action==="reprocess"){const f=b.file(pre+"original.pdf"),[buf]=await f.download();await f.save(buf,{contentType:"application/pdf"})} // re-save triggers processDocument (rebuilds index + TOC)
  else throw new HttpsError("invalid-argument","Bad action");
  await audit("admin_"+r.data.action,me,{path:r.data.path});return{ok:true}});
