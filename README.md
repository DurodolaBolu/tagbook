# Tagbook

The real Tagbook app for laundry and dry cleaning shops. Tagbook by Ordiventa.

- `src/` app source (`app.js`, styles, fonts)
- `site/` built app, served by Cloudflare Pages (no build command, output folder `site`)
- `build.sh` rebuilds `site/` from `src/`
- `test/run.js` drives the app in a phone-sized browser against a stand-in database

Backend: Supabase project "Tagbook". Logins are phone number + 6-digit PIN.
Secretaries never see prices, money, bank details or customer phone numbers (enforced in the database).

## Deploying

Always deploy with `./deploy.sh "what changed"` from the repo root. It:

1. builds `site/` (`./build.sh`),
2. runs `scripts/predeploy.sh`: `node --check` on every JS file, no secret or service keys (Paystack `sk_`, Supabase `sb_secret_` or `service_role`, private keys, `.env`, `.map`) in `src/` or `site/`, no `console.log`, no `setInterval` polling, and `site/404.html` present,
3. runs the browser tests (`node test/run.js`; skip with `SKIP_TESTS=1`),
4. commits and pushes to `main` (Cloudflare Pages deploys it),
5. runs `scripts/postdeploy.sh`: waits for the new build to be live, then checks `/.env`, `/.git/config`, `/.git/HEAD` and every `.js.map` return 404.

Any failure in steps 2 or 3 stops the deploy before the push. `./deploy.sh` also turns on `.githooks/pre-push`, so a plain `git push` runs the same pre-deploy checks.
A line that really needs `console.log` or `setInterval` can end with `// predeploy-allow: reason`.
