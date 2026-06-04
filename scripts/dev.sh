#!/usr/bin/env bash
# Starts the Firebase emulators, seeds them, then runs the web dev server.
# Intended for local dev and Codespaces — Ctrl+C stops everything.
set -euo pipefail

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Always regenerate apps/web/.env.local so the web app has valid emulator
# config — guards against a missing or stale file from an interrupted setup.
echo "==> Ensuring apps/web/.env.local"
bash scripts/write-env-local.sh

echo "==> Building Cloud Functions (required for functions emulator)"
pnpm --filter @linyup/functions run build

echo "==> Starting Firebase emulators (auth, firestore, functions)"
# Use pnpm exec so the firebase-tools binary resolves from node_modules/.bin
# regardless of how this script is invoked.
pnpm exec firebase emulators:start --only auth,firestore,functions --project demo-linyup &

echo "==> Waiting for Firestore emulator on :8080"
until curl -s http://127.0.0.1:8080 >/dev/null 2>&1; do sleep 1; done
echo "==> Waiting for Auth emulator on :9099"
until curl -s http://127.0.0.1:9099/ 2>/dev/null | grep -q '"ready"'; do sleep 1; done
echo "==> Waiting for Functions emulator on :5001"
until curl -s http://127.0.0.1:5001 >/dev/null 2>&1; do sleep 1; done
echo "    emulators up"

# Note: in a Codespace the browser reaches the emulators via same-origin
# proxy rewrites on the Next.js dev server (see apps/web/next.config.ts),
# so the emulator ports do not need to be made public.

echo "==> Seeding emulator data"
pnpm exec tsx scripts/seed-emulator.ts || echo "    seed failed (continuing anyway)"

echo "==> Starting Next.js dev server on :3000"
pnpm --filter @linyup/web dev
