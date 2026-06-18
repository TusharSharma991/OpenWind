# OpenWind Setup Guide

Everything you need to run OpenWind — locally for development, or on a
production server with a real domain and HTTPS.

---

## Contents

- [Local development](#local-development)
- [Production deployment](#production-deployment)
- [What bootstrap does](#what-bootstrap-does)
- [Accounts and credentials](#accounts-and-credentials)
- [Common operations](#common-operations)
- [Troubleshooting](#troubleshooting)

---

## Local development

### What you need

| Tool    | Version | Install                            |
| ------- | ------- | ---------------------------------- |
| Node.js | 22+     | https://nodejs.org                 |
| pnpm    | 9+      | `npm install -g pnpm`              |
| Docker  | 24+     | https://docs.docker.com/get-docker |

Docker Desktop must be **running** before you start.

### First-time setup

```bash
git clone https://github.com/TusharSharma991/OpenWind.git
cd OpenWind
pnpm install
pnpm bootstrap
```

That is the entire setup. Bootstrap starts all Docker services, migrates the
database, configures Zitadel (the identity provider), creates demo users, and
prints login credentials. No browser steps, no copy-pasting tokens.

When it finishes, open **http://localhost:3001** and log in with
`owAdmin` / `OpenWind1234!`.

### Reset from scratch

```bash
docker compose down -v   # stop all containers and wipe volumes
rm .env.local            # remove generated credentials
pnpm bootstrap           # full automated setup again
```

Always use `-v`. Without it the old Postgres/Zitadel data survives and
conflicts with the new setup.

### Day-to-day commands

```bash
docker compose up -d                               # start everything
docker compose down                                # stop (data preserved)
docker compose logs -f ow-backend                  # tail API logs
docker compose up -d --build ow-backend            # rebuild after a code change
docker compose up -d --force-recreate ow-frontend  # restart with fresh env
```

---

## Production deployment

Production has one critical requirement local does not: **Zitadel must know it
is behind HTTPS before its very first boot.** Zitadel writes the issuer URL into
its own database during `start-from-init`. If it starts with `http://`, that
issuer is permanent — every browser auth request from an HTTPS page will be
blocked as mixed content and login will never work. There is no fix short of
wiping the database and starting over.

Follow these steps **in order**. Do not start any container before Step 3.

### Step 1 — Server prerequisites

- Docker and Docker Compose v2 installed
- A reverse proxy (nginx, Caddy, Traefik) handling SSL termination and
  forwarding traffic to container ports — containers run HTTP internally, TLS
  lives at the proxy layer only
- Two subdomains with valid TLS certificates:
  - `openwind.yourdomain.com` → proxy to the frontend container host port
  - `owzitadel.yourdomain.com` → proxy to the Zitadel container host port

### Step 2 — Clone the repo

```bash
git clone https://github.com/TusharSharma991/OpenWind.git ~/openwind
cd ~/openwind
```

### Step 3 — Create the override file

Docker Compose automatically merges `docker-compose.override.yml` into the base
config. This file holds all server-specific config — real domains, host ports,
HTTPS flags — and must **never** be committed to git.

Create `~/openwind/docker-compose.override.yml`:

```yaml
services:
  zitadel:
    restart: unless-stopped
    command: >
      start-from-init --masterkey "MasterkeyNeedsToHave32Characters"
      --tlsMode disabled
    ports:
      - "10405:8080" # nginx proxies owzitadel.yourdomain.com:443 → this port
    environment:
      # !! Must be set BEFORE the very first boot.
      # Zitadel writes {scheme}://{EXTERNALDOMAIN} as the issuer into its DB at
      # init time. With EXTERNALSECURE=false the issuer is http:// — permanently,
      # until the DB is wiped and re-created.
      ZITADEL_EXTERNALDOMAIN: owzitadel.yourdomain.com
      ZITADEL_EXTERNALPORT: 443
      ZITADEL_EXTERNALSECURE: "true"
    networks:
      default:
        aliases:
          # Lets other containers reach Zitadel by its public hostname
          # without leaving the Docker network.
          - owzitadel.yourdomain.com

  ow-backend:
    environment:
      # Backend contacts Zitadel over the internal Docker network (HTTP is fine
      # here — TLS is handled by the reverse proxy, not inside Docker).
      ZITADEL_JWKS_URL: http://owzitadel.yourdomain.com:8080/oauth/v2/keys
      ZITADEL_INTROSPECTION_URL: http://owzitadel.yourdomain.com:8080/oauth/v2/introspect
      # Must match the JWT iss claim — the external HTTPS URL.
      ZITADEL_ISSUER: https://owzitadel.yourdomain.com
      CORS_ORIGIN: https://openwind.yourdomain.com

  ow-frontend:
    ports:
      - "10404:3001" # nginx proxies openwind.yourdomain.com:443 → this port

  postgres:
    ports:
      - "54320:5432" # optional: direct Postgres access from the host
```

Replace every `yourdomain.com` with your real domain. Pick host ports (`10404`,
`10405`) that are free on the server.

### Step 4 — Create the compose env file

Docker Compose reads `.env` from the project root for `${}` variable
substitution inside the YAML. Create it:

```bash
cat > ~/openwind/.env << 'EOF'
ZITADEL_EXTERNAL_DOMAIN=owzitadel.yourdomain.com
ZITADEL_HOST_PORT=10405
ZITADEL_EXTERNALSECURE=true
EOF
```

This tells the bootstrap container to generate `https://` URLs when writing
credentials to `.env.local`.

### Step 5 — Run bootstrap

```bash
cd ~/openwind
docker compose --profile bootstrap run --rm bootstrap
```

Bootstrap starts all services, waits up to 90 seconds for Zitadel to finish
first-boot initialisation, then configures the full identity layer and prints
login credentials.

After it finishes, restart the app containers to load the new credentials:

```bash
docker compose restart ow-backend ow-frontend
```

### Step 6 — Fix Zitadel console redirect URIs (one-time)

Due to a Zitadel quirk, the console app's redirect URIs are sometimes stored as
`http://...:443` instead of `https://` on first boot. Fix this once — it does
not recur unless you wipe the database.

```bash
# 1. Find the console app ID
docker exec ow-database psql -U platform -d zitadel \
  -c "SELECT a.id AS app_id, a.name, oc.client_id
      FROM projections.apps7 a
      JOIN projections.apps7_oidc_configs oc ON a.id = oc.app_id;"
```

Note the `app_id` from the `Management Console` row.

```bash
# 2. Check what client_id the console frontend expects
curl -sk https://owzitadel.yourdomain.com/ui/console/assets/environment.json
# → {"clientid":"XXXXXXXXXXXXXXX", ...}
```

If `clientid` from `environment.json` differs from `client_id` in the DB,
align them:

```bash
docker exec ow-database psql -U platform -d zitadel -c "
UPDATE projections.apps7_oidc_configs
  SET client_id = '<clientid from environment.json>'
  WHERE app_id = '<app_id from step 1>';

UPDATE eventstore.unique_constraints
  SET unique_field = '<clientid from environment.json>'
  WHERE unique_field = '<old client_id from DB>';
"
```

Then fix the redirect URIs:

```bash
docker exec ow-database psql -U platform -d zitadel -c "
UPDATE projections.apps7_oidc_configs
SET
  redirect_uris = '{https://owzitadel.yourdomain.com/ui/console/auth/callback}',
  post_logout_redirect_uris = '{https://owzitadel.yourdomain.com/ui/console/signedout}'
WHERE app_id = '<app_id from step 1>';
"
```

### Step 7 — Verify

| URL                                           | Expected                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `https://openwind.yourdomain.com`             | App loads; log in with `owAdmin` / `OpenWind1234!`                                |
| `https://owzitadel.yourdomain.com/ui/console` | Zitadel console loads; log in with `owZitadelAdmin@openwind.local` / `Admin1234!` |

### Updating production after a code change

```bash
cd ~/openwind
git pull
docker compose up -d --build ow-backend ow-frontend
```

Bootstrap does not need to re-run for code-only updates.

### Production reset

```bash
docker compose stop zitadel     # disconnect active sessions first
docker exec ow-database psql -U platform -c "DROP DATABASE IF EXISTS zitadel;"
docker compose down -v
rm .env.local
docker compose --profile bootstrap run --rm bootstrap
docker compose restart ow-backend ow-frontend
# Repeat Step 6 after reset
```

---

## What bootstrap does

Bootstrap is fully automated and idempotent — safe to re-run at any time.

| Step | Action                                                                 | Why                                                         |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | Check Node 22+, pnpm, Docker (skipped when running inside Docker)      | Fast-fail before any side effects                           |
| 2    | Copy `.env.example` → `.env.local` if missing                          | File must exist for credential writes                       |
| 3    | `docker compose up -d` (skipped inside Docker)                         | Start Postgres, Redis, Zitadel                              |
| 4    | Poll pgbouncer + Zitadel until healthy (up to 90s)                     | Zitadel runs DB setup equivalent on first boot              |
| 5    | `pnpm install` + build `@platform/config` and `@platform/db`           | Runtime scripts import these packages                       |
| 6    | Run all SQL migrations via Drizzle                                     | Creates schema, RLS policies, indexes                       |
| 7    | Create Zitadel project, OIDC app, introspection SA, roles, machine key | Full identity layer; writes all credentials to `.env.local` |
| 8    | Create demo users (`owAdmin`, `owUser`, `testUser1–5`)                 | Ready-to-use logins                                         |
| 9    | Note module templates auto-seed on first page visit                    | Nothing to do here                                          |
| 10   | Print summary of all URLs and credentials                              |                                                             |

**How it authenticates with Zitadel without any browser step:**

1. The compose file sets `ZITADEL_FIRSTINSTANCE_MACHINEKEYPATH` so Zitadel writes
   a machine key JSON to a shared Docker volume on first boot.
2. Bootstrap reads that file directly from the mounted volume — no `docker exec`.
3. Bootstrap fetches the real issuer URL from `/.well-known/openid-configuration`
   so the JWT `aud` claim matches exactly.
4. Bootstrap signs a short-lived JWT with the machine key and exchanges it for an
   access token via the `jwt-bearer` OAuth grant.
5. All subsequent Zitadel API calls use that token.

---

## Accounts and credentials

All passwords below are development defaults. Change them in production.

### App (`http://localhost:3001` or `https://openwind.yourdomain.com`)

| Username                  | Password        | Role  | Access                 |
| ------------------------- | --------------- | ----- | ---------------------- |
| `owAdmin`                 | `OpenWind1234!` | admin | Full platform          |
| `owUser`                  | `OpenWind1234!` | user  | Customer / portal view |
| `testUser1` – `testUser5` | `OpenWind1234!` | user  | Test accounts          |

Full email format also works: `owAdmin@openwind.local`, `owUser@openwind.local`, etc.

### Zitadel console (`http://localhost:8080` or `https://owzitadel.yourdomain.com/ui/console`)

| Username                        | Password     | Access                  |
| ------------------------------- | ------------ | ----------------------- |
| `owZitadelAdmin@openwind.local` | `Admin1234!` | Identity provider admin |

---

## Common operations

### Force a container to reload env vars

`docker compose restart` reuses the existing container — it does **not** re-read
`env_file` changes. Use this instead:

```bash
docker compose up -d --force-recreate ow-backend ow-frontend
```

### Run migrations manually

```bash
pnpm db:migrate
```

### Seed demo data

```bash
pnpm db:seed       # base tenant (idempotent)
pnpm seed:demo     # Helpdesk sample tickets and workflow
```

### Direct database access

```bash
docker compose exec postgres psql -U platform -d platform

-- All tenants
SELECT id, slug, status FROM tenants;

-- Applied migrations
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

---

## Troubleshooting

### Mixed content error on login

```
Mixed Content: The page at 'https://...' requested an insecure resource 'http://...'
```

Zitadel initialised with `EXTERNALSECURE=false`. Its issuer URL is permanently
`http://` in the database. Fix: ensure `ZITADEL_EXTERNALSECURE: "true"` is in
the override, then wipe and reinitialise:

```bash
docker compose stop zitadel
docker exec ow-database psql -U platform -c "DROP DATABASE IF EXISTS zitadel;"
docker compose up -d --force-recreate zitadel
# wait ~90s then re-run bootstrap
```

### `Errors.App.NotFound` on Zitadel console

The console app client_id in `environment.json` does not match the database.
Follow Step 6 above to align them.

### `redirect_uri missing in client configuration`

The console app's redirect URIs are stored as `http://...:443`. Follow the
redirect URI update query in Step 6.

### API returns 401 after login

Stale `ZITADEL_AUDIENCE` in the backend container. Fix:

```bash
docker compose up -d --force-recreate ow-backend
```

### `DROP DATABASE` fails with active sessions

Stop Zitadel first: `docker compose stop zitadel`, then retry.

### Migration fails with `permission denied`

Migrations need `MIGRATION_DATABASE_URL` (direct Postgres), not `DATABASE_URL`
(PgBouncer). Check `.env.local` has:

```
MIGRATION_DATABASE_URL=postgresql://migration_user:migration_user_dev_password@localhost:5432/platform
```

### Bootstrap times out waiting for Zitadel

Normal on first boot — Zitadel runs its own DB initialisation which takes up to
90 seconds. Bootstrap waits automatically. If it still fails:

```bash
docker compose logs ow-identity --tail=50
```

Common cause: wrong Postgres credentials in the Zitadel environment block.

### Port already in use

```bash
# macOS / Linux
lsof -i :3001
# Windows
netstat -ano | findstr :3001
```

Change the host port on the left side of the `ports:` entry. For production,
set it in `docker-compose.override.yml`.

### Platform notes

**macOS Apple Silicon** — if you see `exec format error`, ensure Docker Desktop
uses the Apple Silicon VM, not Rosetta.

**Linux** — add your user to the docker group:

```bash
sudo usermod -aG docker $USER && newgrp docker
```

**Windows** — run from PowerShell or Git Bash. No WSL2 required.
