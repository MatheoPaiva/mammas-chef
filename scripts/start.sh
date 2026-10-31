#!/usr/bin/env bash
# Runs the database, the AI functions and the website together. Ctrl+C stops the last two.
set -euo pipefail
cd "$(dirname "$0")/.."

grep -qE '^(AI_API_KEY|CEREBRAS_API_KEY)=.+' supabase/functions/.env 2>/dev/null || {
  echo "No AI key found. Add one to supabase/functions/.env (run npm run setup first if that file is missing)."
  exit 1
}

npx supabase start
npx supabase functions serve --env-file supabase/functions/.env &
trap 'kill $! 2>/dev/null || true' EXIT
npm run dev
