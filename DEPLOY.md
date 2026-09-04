# Deploying the read-only demo

The public demo is the whole stack running normally — real Postgres, MQTT broker
and simulators pushing live telemetry — with **writes disabled** so anyone can
click around without breaking it. A write attempt shows a dialog explaining how
to run the full thing locally.

Two layers enforce it:

| Layer | What it does | Toggle |
| --- | --- | --- |
| Backend | Any non-GET under `/api/v1` returns `403 READ_ONLY_DEMO` | `DEMO_READ_ONLY=true` |
| Dashboard | Intercepts writes client-side, pops the "run it locally" modal, shows a banner | `VITE_DEMO_MODE=true` (build-time) |

The backend layer is the real guard; the dashboard layer is UX. Because nothing
can reach the admin write endpoints, the demo overlay also drops the Docker
socket mount and runs a fixed set of three simulators.

## One-time setup on the host

Requirements: a small VM (~2 GB RAM), Docker + Compose plugin, a DNS `A` record
for your demo hostname pointing at the VM, and ports 80/443 open.

```bash
git clone <your repo> /opt/production-monitoring
cd /opt/production-monitoring
cp .env.example .env
```

Edit `.env`:

```dotenv
POSTGRES_PASSWORD=<a real password>
DATABASE_URL=postgresql://production_monitoring:<that password>@postgres:5432/production_monitoring

DEMO_DOMAIN=demo.example.com
DEMO_PUBLIC_URL=https://demo.example.com
REPO_URL=https://github.com/your-username/production-monitoring

VITE_API_BASE_URL=https://demo.example.com/api/v1
VITE_WS_URL=wss://demo.example.com/live
```

## Bring it up

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Caddy fetches a Let's Encrypt certificate on first start. Visit
`https://demo.example.com` — the amber "Read-only demo" banner confirms the demo
build is live. Try saving something on the ERP or Admin page to see the modal.

Only ports 80/443 (Caddy) are published to the host; Postgres, MQTT, the backend
and the dashboard are reachable only on the internal Compose network.

## Keeping it tidy

`machine_telemetry` grows every 2 s per simulator. Reset the history nightly via
cron on the host (keeps the registry, ERP master data and TLS cert):

```cron
0 4 * * * /opt/production-monitoring/scripts/reset-demo.sh >> /var/log/demo-reset.log 2>&1
```

## Updating

```bash
cd /opt/production-monitoring
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Running it locally (what the modal tells visitors)

```bash
git clone <your repo>
cd production-monitoring
cp .env.example .env
docker compose up --build
```

That base stack has no demo flags: writes work, and the Admin page can start and
stop simulator containers through the mounted Docker socket.
