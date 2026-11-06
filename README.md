# Tagbook

The real Tagbook app for laundry and dry cleaning shops. Tagbook by Ordiventa.

- `src/` app source (`app.js`, styles, fonts)
- `site/` built app, served by Cloudflare Pages (no build command, output folder `site`)
- `build.sh` rebuilds `site/` from `src/`
- `test/run.js` drives the app in a phone-sized browser against a stand-in database

Backend: Supabase project "Tagbook". Logins are phone number + 6-digit PIN.
Secretaries never see prices, money, bank details or customer phone numbers (enforced in the database).
