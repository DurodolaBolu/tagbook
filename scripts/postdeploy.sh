#!/bin/bash
# Tagbook post-deploy checks on the live site. Run automatically by ./deploy.sh after the push.
# 1. Waits until the live site serves the build that was just pushed (up to 5 minutes).
# 2. Confirms secret and source files are NOT reachable: /.env, /.git/config, /.git/HEAD and the .map
#    of every published .js file must return 404.
# Exit 0 = all good, 1 = a check failed (roll back in Cloudflare Pages, Deployments, previous build),
# 2 = the live site could not be reached from this computer (check by hand).
# Run by hand: scripts/postdeploy.sh
set -u
cd "$(dirname "$0")/.."
SITE="${TAGBOOK_URL:-https://tagbook.ordiventa.com}"
WANT=$(sed -E 's/.*"v":"([0-9]+)".*/\1/' site/version.json 2>/dev/null)

echo "Tagbook post-deploy checks on $SITE"

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }

# Wait for the new build to be live
LIVE=""
for i in $(seq 1 30); do
  LIVE=$(curl -s --max-time 15 "$SITE/version.json?t=$(date +%s)" | sed -E 's/.*"v":"([0-9]+)".*/\1/')
  [ "$LIVE" = "$WANT" ] && break
  [ -z "$LIVE" ] && [ "$i" -ge 3 ] && { echo "  Can't reach $SITE from this computer. Check the live site by hand."; exit 2; }
  sleep 10
done
if [ "$LIVE" != "$WANT" ]; then echo "  The live site still shows build ${LIVE:-unknown}, not $WANT, after 5 minutes. Check Cloudflare Pages."; exit 1; fi
echo "  Live site is on build $WANT"

FAIL=0
PATHS="/.env /.git/config /.git/HEAD /.env.local /build.sh /package.json /src/app.js"
for f in $(cd site && find . -name '*.js' | sed 's#^\.##'); do PATHS="$PATHS $f.map"; done
for p in $PATHS; do
  c=$(code "$SITE$p")
  if [ "$c" = "404" ]; then printf '  \033[32mPASS\033[0m %s returns 404\n' "$p"
  else printf '  \033[31mFAIL\033[0m %s returns %s (should be 404)\n' "$p" "$c"; FAIL=1; fi
done

echo
if [ "$FAIL" -ne 0 ]; then echo "Post-deploy checks FAILED. Roll back in Cloudflare Pages (Deployments, pick the previous build, Rollback) and fix."; exit 1; fi
echo "All post-deploy checks passed."
