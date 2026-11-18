#!/bin/sh
set -e

echo "Eseguo le migrazioni..."
node --env-file-if-exists=.env scripts/migrate.mjs

echo "Avvio API (porta ${API_PORT:-4000}) e Web (porta ${WEB_PORT:-3000})..."
node --env-file-if-exists=.env server/index.ts &
API_PID=$!

PORT=${WEB_PORT:-3000} npm run start &
WEB_PID=$!

trap "kill $API_PID $WEB_PID 2>/dev/null" TERM INT

wait $API_PID $WEB_PID
