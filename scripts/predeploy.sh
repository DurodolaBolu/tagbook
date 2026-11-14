#!/bin/bash
# Tagbook pre-deploy checks. Stops the deploy (exit 1) if any check fails.
# Runs automatically from ./deploy.sh and from the git pre-push hook (.githooks/pre-push).
# Run by hand: scripts/predeploy.sh
#
# A line that genuinely needs console.log or setInterval can be allowed by ending it with:
#   // predeploy-allow: <reason>
set -u
cd "$(dirname "$0")/.."

FAIL=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=1; }

echo "Tagbook pre-deploy checks"

# Our own code. site/app.js is left out of the console.log and setInterval checks because it
# bundles the Supabase library (which uses both); our code in it comes from src/app.js, which is checked.
OWN_CODE=(src scripts site/sw.js site/index.html site/privacy.html site/404.html)
PUBLISHED=site

# 1. The built site exists and is current
if [ ! -f site/index.html ] || [ ! -f site/app.js ] || [ ! -f site/version.json ]; then
  fail "site/ is missing files. Run ./build.sh first."
else
  NEWEST_SRC=$(find src -type f -newer site/version.json | head -1)
  if [ -n "$NEWEST_SRC" ]; then fail "site/ is older than $NEWEST_SRC. Run ./build.sh first."; else pass "site/ is built from the current src/"; fi
fi

# 2. node --check on every JavaScript file (app code, built site, tests, scripts)
BAD=""
while IFS= read -r f; do
  node --check "$f" 2>/tmp/tb-check.$$ || BAD="$BAD\n    $f: $(head -1 /tmp/tb-check.$$)"
done < <(find src site test scripts -name '*.js' -not -path '*/node_modules/*' 2>/dev/null)
rm -f /tmp/tb-check.$$
if [ -n "$BAD" ]; then fail "node --check failed:$BAD"; else pass "node --check on all JS files"; fi

# 3. No secret or service keys in anything that gets published or in src/
HITS=$(grep -rnE 'sk_(live|test)_[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9_-]{10,}|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"[[:space:]]*:' src "$PUBLISHED" 2>/dev/null | cut -c1-160)
# Supabase JWT keys: anon is fine, anything else (service_role) is a leak
JWT_BAD=$(grep -rhoE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' src "$PUBLISHED" 2>/dev/null | sort -u | node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const t of lines) {
    try { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); if (p.role && p.role !== "anon") console.log("JWT with role " + p.role + ": " + t.slice(0, 24) + "..."); } catch (_) {}
  }')
LEAK_FILES=$(find "$PUBLISHED" \( -name '.env*' -o -name '*.map' -o -name '.git' -o -name '*.pem' -o -name '*.key' \) 2>/dev/null)
if [ -n "$HITS$JWT_BAD$LEAK_FILES" ]; then
  fail "secret keys or private files found:"
  [ -n "$HITS" ] && echo "$HITS" | sed 's/^/    /'
  [ -n "$JWT_BAD" ] && echo "$JWT_BAD" | sed 's/^/    /'
  [ -n "$LEAK_FILES" ] && echo "$LEAK_FILES" | sed 's/^/    file in site\/: /'
else
  pass "no secret keys, service keys, .env, .map or key files in src/ or site/"
fi

# 4. No console.log (or console.debug) in our code
LOGS=$(grep -rnE 'console\.(log|debug)\(' "${OWN_CODE[@]}" 2>/dev/null | grep -v 'predeploy-allow' | grep -v '^scripts/predeploy.sh' | cut -c1-160)
if [ -n "$LOGS" ]; then fail "console.log found:"; echo "$LOGS" | sed 's/^/    /'; else pass "no console.log in app code"; fi

# 5. No setInterval polling in our code
POLL=$(grep -rnE 'setInterval\(' "${OWN_CODE[@]}" 2>/dev/null | grep -v 'predeploy-allow' | grep -v '^scripts/predeploy.sh' | cut -c1-160)
if [ -n "$POLL" ]; then fail "setInterval polling found:"; echo "$POLL" | sed 's/^/    /'; else pass "no setInterval polling in app code"; fi

# 6. A real 404 page exists, so unknown paths like /.env return 404 on Cloudflare Pages
if [ -f site/404.html ]; then pass "site/404.html present (unknown paths return 404)"; else fail "site/404.html missing: Cloudflare would answer /.env and /.git/config with the app page (status 200)"; fi

echo
if [ "$FAIL" -ne 0 ]; then echo "Pre-deploy checks FAILED. Nothing was deployed."; exit 1; fi
echo "All pre-deploy checks passed."
