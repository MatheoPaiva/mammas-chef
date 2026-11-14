#!/usr/bin/env bash
# One-time install: dependencies, local database, and config files.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker is required: https://www.docker.com/products/docker-desktop/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start it and try again."; exit 1; }

npm ci
npx supabase start

if [ -f .env.local ]; then
  echo "Keeping your existing .env.local"
else
  status="$(npx supabase status -o env 2>/dev/null)"
  value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }
  printf 'VITE_SUPABASE_URL="%s"\nVITE_SUPABASE_PUBLISHABLE_KEY="%s"\n' "$(value API_URL)" "$(value ANON_KEY)" > .env.local
fi

[ -f supabase/functions/.env ] || cp supabase/functions/.env.example supabase/functions/.env
chmod 600 supabase/functions/.env  # holds your AI key; also repairs installs made before this line existed

echo
echo "Setup finished. Add your AI key to supabase/functions/.env, then run: npm start"
