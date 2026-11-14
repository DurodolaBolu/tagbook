#!/bin/bash
# Tagbook deploy: build, check, test, push, then check the live site.
# Usage:  ./deploy.sh "what changed"
#         SKIP_TESTS=1 ./deploy.sh "what changed"   (skip the 2-minute browser tests; checks still run)
# Stops before pushing if any pre-deploy check or test fails, so nothing broken goes live.
set -e
cd "$(dirname "$0")"
MSG="${1:-Update Tagbook}"

# Make plain "git push" run the same checks on this computer too
git config core.hooksPath .githooks

./build.sh
scripts/predeploy.sh
if [ "${SKIP_TESTS:-0}" != "1" ]; then node test/run.js > /tmp/tagbook-test.log 2>&1 || { tail -30 /tmp/tagbook-test.log; echo "Tests FAILED. Nothing was deployed."; exit 1; }; echo "Tests passed."; fi

git add -A
git diff --cached --quiet || git commit -q -m "$MSG"
git push origin main

set +e
scripts/postdeploy.sh
case $? in
  0) echo "Deployed and verified." ;;
  2) echo "Deployed. Live checks couldn't run from here: open the site and check /.env and /.git/config show 'Page not found'." ;;
  *) echo "Deployed, but the live checks FAILED (see above)."; exit 1 ;;
esac
