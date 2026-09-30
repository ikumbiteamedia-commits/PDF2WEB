// Usage: GOOGLE_APPLICATION_CREDENTIALS=key.json node grant-admin.js <uid>
const a=require("firebase-admin");a.initializeApp();a.auth().setCustomUserClaims(process.argv[2],{admin:true}).then(()=>console.log("admin granted"));
