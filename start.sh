#!/usr/bin/env bash
# One-run bootstrap: installs dependencies, creates the admin account on
# first run only, then starts the server. Safe to re-run any time —
# it skips steps that are already done.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (npm install)…"
  npm install
else
  echo "==> Dependencies already installed, skipping npm install."
fi

if [ ! -f .env ]; then
  echo "==> No .env found, creating one from .env.example…"
  cp .env.example .env
  echo "==> Edit .env now if you want to change the port, file root, etc. Continuing with defaults in 3s…"
  sleep 3
fi

if [ ! -f data/users.json ]; then
  echo "==> No admin account found — let's create one."
  npm run setup
fi

echo "==> Starting the server…"
npm start
