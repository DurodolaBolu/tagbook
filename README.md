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

## If Bolu is not available (handover)

Everything someone needs to keep Tagbook running. Passwords and keys are NOT in this repo: they live in the password manager (see "Access" below).

### Run it on a computer
1. Install Node.js 20 or newer and git. Clone this repo.
2. `npm install`, then `./build.sh`. The app is now in `site/`.
3. `node test/run.js` opens the app at http://localhost:8787 against a stand-in database and runs every check (no real data is touched).
4. To work against the real database, just open the live site: the app talks to Supabase directly with the public key in `src/app.js` (safe to be public; the database rules protect the data).

### Where each part runs
| Part | Where | Notes |
|---|---|---|
| App (this repo, `site/`) | Cloudflare Pages, project "tagbook", domain tagbook.ordiventa.com | Deploys automatically when `main` is pushed. Deploy with `./deploy.sh`. |
| Database, logins, file storage | Supabase project "Tagbook" (id `uungxatdvelljmaugzuz`), org "DurodolaBolu's Org", free plan | Tables, rules (RLS) and database functions live here. |
| Server code | Supabase Edge Functions, copies in `supabase/functions/` | `admin` (shops, staff, PINs, sign-up, SMS codes), `login` (PIN login with lockout), `billing` (Paystack), `photos` (drop-off photos), `notify` (push), `wa`, `wa-weekly` (WhatsApp, paused). Deploy a change by pasting the full file into Supabase (Edge Functions, the function, Code) or with the Supabase CLI. |
| Scheduled jobs | Supabase, Database, Cron | Bill and due reminders, nudges (8am), payment re-check every 10 minutes, photo cleanup (2am), team earnings, weekly WhatsApp report (paused). |
| Text message codes | Termii (app.termii.com), workspace "Ordiventa", sender "OE Alert", DND route | Top up the wallet there. Only the approved message wording may be sent. |
| Card and transfer payments | Paystack (Ordiventa account) | Tagbook re-checks payments itself every 10 minutes; the Paystack webhook box is used by LegacyOS. |
| Code | GitHub repo for this folder | `main` is what is live. |
| Domain ordiventa.com | Domain registrar plus Cloudflare DNS | tagbook.ordiventa.com points to Cloudflare Pages. |
| Android app | Google Play (com.ordiventa.tagbook), built with PWABuilder from the live site | `src/assetlinks.json` must keep the signing key fingerprints. |

### Secrets (names only; values are in Supabase, Edge Functions, Secrets)
- `TERMII_KEY`: Termii API key (SMS codes). Optional: `TERMII_SENDER_ID` (default "OE Alert").
- `PAYSTACK_SECRET_KEY`: Paystack secret key (billing).
- `WA_TOKEN`, `WA_PHONE_ID`, `WA_NUMBER`, `WA_VERIFY`, `WA_APP_SECRET`: WhatsApp Cloud API (paused since Meta banned the account).
- `TURNSTILE_SECRET`: optional Cloudflare bot check on sign-up (not set).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`: provided by Supabase automatically.
- The login "pepper" and the admin key live inside the database (`private` schema), never in code.

### Backups and restore
- The Supabase free plan has NO restorable backups. Until a backup job or the Pro plan is in place, a bad delete cannot be undone.
- Code: GitHub has every version. To roll back the app, revert the commit and run `./deploy.sh`.
- Database structure: every change is recorded in Supabase (Database, Migrations).

### Access
Logins for Supabase, Cloudflare, GitHub, Termii, Paystack, Google Play and the domain registrar are kept in Bolu's password manager, shared with one trusted person who can act if Bolu cannot.
