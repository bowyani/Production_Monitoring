# Deploying the demo

> **This branch (`deploy/render-static-mock`) is the fully static demo.** It has
> no backend — the dashboard runs on synthetic data generated in the browser
> (`dashboard/src/lib/mock/*`) with a fake live feed, and every write pops a
> dialog pointing people at the **main** branch for the real thing. Jump to
> [Fully static demo on Render](#fully-static-demo-on-render).
>
> The rest of this file describes the heavier **read-only demo** (real backend,
> writes disabled) that lives on `main` / `feat/read-only-demo`.

## Fully static demo on Render

`render.yaml` on this branch defines a single **free static site**. Nothing to
configure:

1. Edit `render.yaml` — set `VITE_REPO_URL` and `VITE_MAIN_BRANCH_URL` to your
   repo.
2. Render Dashboard → New → Blueprint → pick this repo and the
   `deploy/render-static-mock` branch.
3. Done. `https://<name>.onrender.com` serves the dashboard; it never sleeps
   (static sites are always on) and costs nothing.

Local check of this exact build:

```bash
cd dashboard
VITE_MOCK=true npm run build && npm run preview
```

To refresh the demo, just push to this branch — Render rebuilds. There is no
database to reset; every page load starts the in-browser simulation fresh.

---

# Deploying the read-only demo

The read-only demo is the whole stack running normally — real Postgres, MQTT
broker and simulators pushing live telemetry — with **writes disabled** so anyone
can click around without breaking it. A write attempt shows a dialog explaining
how to run the full thing locally.

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

## Alternative: read-only demo on Render

Because the demo overlay already dropped the Docker-socket dependency, the
read-only stack also fits Render's Blueprint model — managed Postgres, an
internal broker, the backend as a web service (TLS + WebSockets come free), the
dashboard as a static site, and simulators as workers. The **full-stack**
`render.yaml` lives on `main` / `feat/read-only-demo` (on this branch
`render.yaml` is the static-only one described at the top).

Steps: Render Dashboard → New → Blueprint → pick this repo on that branch. After
the first deploy, fill the env vars marked `sync: false`:

| Service | Var | Value |
| --- | --- | --- |
| dashboard | `VITE_API_BASE_URL` | `https://<backend>.onrender.com/api/v1` |
| dashboard | `VITE_WS_URL` | `wss://<backend>.onrender.com/live` |
| backend | `CORS_ORIGIN` | `https://<dashboard>.onrender.com` |

Then redeploy the dashboard so the new build picks up the URLs.

Trade-offs vs. the single VPS above:

- **Free instances sleep after ~15 min idle** — the live feed stops until the
  next visitor wakes it (~50 s cold start). Put `backend` and `simulator-01` on
  `starter` (~$7/mo each) for an always-on demo.
- **Free Postgres is deleted after 30 days.** Use `starter`, or point
  `DATABASE_URL` at a free external Neon/Supabase database.
- **Background workers have no free plan**, so each extra simulated machine is a
  billable instance. The Blueprint ships one; copy the block for more.
- **Mosquitto on Render is finicky** (private service, no free plan, port
  detection). Simpler to use a hosted broker — HiveMQ Cloud has a free tier;
  set `MQTT_BROKER_URL` to its `mqtts://user:pass@host:8883` URL and delete the
  `mqtt` service.

Realistic always-on cost on Render lands around $15–20/mo; the $5 VPS running the
Compose file does the same job for less, at the cost of managing the box.

## Running it locally (what the modal tells visitors)

```bash
git clone <your repo>
cd production-monitoring
cp .env.example .env
docker compose up --build
```

That base stack has no demo flags: writes work, and the Admin page can start and
stop simulator containers through the mounted Docker socket.
