#!/bin/sh
# Start command for the hosted API (Railway): migrate (and seed the demo orgs), then serve the API.
set -e
python scripts/migrate.py
exec uvicorn yazzy.api.main:app --host 0.0.0.0 --port "${PORT:-10000}" \
  --proxy-headers --forwarded-allow-ips='*'
