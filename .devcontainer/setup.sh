#!/usr/bin/env bash
# Provisions a Codespace / dev container for dgstn-lineup.
# Runs once, as the devcontainer postCreateCommand.
set -euo pipefail

echo "==> Enabling pnpm via corepack"
corepack enable
corepack prepare pnpm@9.15.0 --activate

# Installs all workspace deps including firebase-tools (a root devDependency),
# so the `firebase` CLI is available to pnpm-invoked scripts via node_modules/.bin.
echo "==> Installing workspace dependencies"
pnpm install

echo "==> Writing apps/web/.env.local (emulator mode)"
bash scripts/write-env-local.sh

echo ""
echo "==> Setup complete."
echo "    Start everything with:  pnpm dev:codespace"
echo "    (Firebase emulators + seed data + Next.js dev server on port 3000)"
