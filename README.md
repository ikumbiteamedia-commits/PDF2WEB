# AAFA
1. Paste web config into `js/firebase.js`; enable Email/Google/Facebook/Apple sign-in.
2. `cd functions && npm i`; `firebase functions:secrets:set FLW_SECRET` and `FLW_HASH`; `firebase deploy`.
3. Seed `plans/monthly {label:"Monthly",usd:20,durationDays:30}` and `plans/yearly {label:"Yearly",usd:200,durationDays:365}`.
4. Flutterwave webhook URL = `flutterwaveWebhook` function URL; secret hash = FLW_HASH.
5. Make an admin: `cd functions && GOOGLE_APPLICATION_CREDENTIALS=key.json node grant-admin.js <uid>`, then log out and in.
Not built: Word/Excel/PPT to PDF (needs LibreOffice on Cloud Run), Create template, OCR, thumbnails, AI rewriting of sections, unique-visitor counts, App Check.
