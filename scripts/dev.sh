#!/usr/bin/env bash
# Starts the Firebase emulators, seeds them, then runs the web dev server.
# Intended for Codespaces / dev containers — Ctrl+C stops everything.
set -euo pipefail

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "==> Starting Firebase emulators (auth, firestore)"
firebase emulators:start --only auth,firestore --project demo-lineup &

echo "==> Waiting for Firestore emulator on :8080"
until curl -s http://127.0.0.1:8080 >/dev/null 2>&1; do sleep 1; done
echo "==> Waiting for Auth emulator on :9099"
until curl -s http://127.0.0.1:9099/ 2>/dev/null | grep -q '"ready"'; do sleep 1; done
echo "    emulators up"

echo "==> Seeding emulator data"
pnpm seed || echo "    seed failed (continuing anyway)"

echo "==> Starting Next.js dev server on :3000"
pnpm --filter @lineup/web dev
