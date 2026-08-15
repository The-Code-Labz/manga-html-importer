#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
{
  echo "[start] $(date)"
  npm install 2>&1
  echo "[build] $(date)"
  npm run build 2>&1
  echo "[server] $(date)"
  exec node dist/server.js
} >> start.log 2>&1
