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

# Env files from their templates (emulator-first; Codespaces mode detected),
# the shared + functions builds every dev path reads, the port slot.
echo "==> Bootstrapping the checkout"
pnpm bootstrap

echo ""
echo "==> Setup complete."
echo "    In VS Code: Run Task (Ctrl+Shift+P → 'Tasks: Run Task') → pick a 'Stack:' preset or a service."
echo "    Or run directly in separate terminals:"
echo "      1) pnpm emulators:seed   # Firebase emulators (auth, firestore, functions, storage) + seed data"
echo "      2) pnpm dev:web          # Next.js dev server on port 3000"
