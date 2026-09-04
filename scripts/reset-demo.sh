#!/usr/bin/env sh
# Wipe accumulated production history so the public demo stays small and tidy.
# Keeps the registry (machines, gateways), ERP master data and the SKU price
# book; clears telemetry, status events, jobs, alarms, orders and the audit log.
# The simulators refill live data within a few seconds.
#
# Run from a cron on the host, e.g. every day at 04:00:
#   0 4 * * * /opt/production-monitoring/scripts/reset-demo.sh >> /var/log/demo-reset.log 2>&1
#
# NOTE: deliberately does NOT `docker compose down -v` — that would also drop
# Caddy's cert volume and re-issuing nightly hits Let's Encrypt rate limits.
set -eu

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. ./.env

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE
  machine_telemetry,
  machine_status_events,
  alarms,
  production_jobs,
  erp_job_orders,
  audit_log
RESTART IDENTITY CASCADE;
SQL

$COMPOSE restart backend simulator-01 simulator-02 simulator-03

echo "demo reset ok: $(date -u +%FT%TZ)"
