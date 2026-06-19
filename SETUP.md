# OpenWind Setup

**Single requirement: Docker Desktop (must be running)**

No Node.js, no pnpm, no tooling on your host machine. Everything runs in containers.

---

## First-time setup

### Step 1 — Start Zitadel and generate a setup token

```
cd zitadel
setup.bat          ← Windows
./setup.sh         ← Linux / Mac
```

This starts the identity provider (`ow-zita`, `ow-zita-db`) and automatically
generates a Personal Access Token for the initial bootstrap. At the end it prints:

```
  setup.bat --pat eyJhbGci...
```

Copy that full command.

---

### Step 2 — Start OpenWind

Paste the command from Step 1 into the OpenWind folder:

```
cd ../OpenWind
setup.bat --pat eyJhbGci...          ← Windows
./setup.sh --pat eyJhbGci...         ← Linux / Mac
```

This starts the database, cache, API, and frontend; runs all DB migrations;
configures Zitadel (project, OIDC app, roles, demo users); and saves the
credentials to `.env.local`.

First run takes **2–5 minutes**.

---

### Done

Open **http://localhost:3001** in your browser.

| Username                  | Password        | Role  |
| ------------------------- | --------------- | ----- |
| `owAdmin`                 | `OpenWind1234!` | Admin |
| `owUser`                  | `OpenWind1234!` | User  |
| `testUser1` – `testUser5` | `OpenWind1234!` | User  |

Zitadel console: **http://localhost:8080**
Login: `owZitadelAdmin@openwind.local` / `Admin1234!`

---

## Day-to-day commands

```bash
# Start everything (after a machine restart)
cd zitadel   && docker compose up -d
cd ../OpenWind && docker compose up -d

# Stop everything (data is preserved)
cd zitadel   && docker compose down
cd ../OpenWind && docker compose down

# Tail API logs
cd OpenWind && docker compose logs -f ow-backend

# Rebuild after a code change
cd OpenWind && docker compose up -d --build ow-backend ow-frontend

# Force-reload env vars into a container
cd OpenWind && docker compose up -d --force-recreate ow-backend
```

---

## Reset from scratch

```bash
cd zitadel   && docker compose down -v
cd ../OpenWind && docker compose down -v
del .env.local       # Windows
rm  .env.local       # Linux / Mac
```

Then run the two setup commands again from Step 1.

---

## Running order matters

Always start Zitadel **before** OpenWind. `ow-backend` connects to Zitadel
on startup to verify JWKS. If Zitadel isn't running, the backend will restart
loop until it is.

---

## Containers reference

| Project  | Container    | Purpose                  | Port        |
| -------- | ------------ | ------------------------ | ----------- |
| zitadel  | ow-zita      | Identity provider (OIDC) | 8080        |
| zitadel  | ow-zita-db   | Zitadel's own Postgres   | (internal)  |
| OpenWind | ow-database  | App Postgres             | 5433 (host) |
| OpenWind | ow-pgbouncer | Connection pooler        | 6432        |
| OpenWind | ow-cache     | Redis                    | (internal)  |
| OpenWind | ow-backend   | Hono API server          | 3000        |
| OpenWind | ow-frontend  | React admin UI           | 3001        |

---

## Troubleshooting

**API returns 401 after login**
Stale credentials — recreate the backend:

```bash
docker compose up -d --force-recreate ow-backend
```

**`setup.bat --pat` fails with "No Zitadel credentials"**
Zitadel may not be running. Start it first:

```bash
cd zitadel && docker compose up -d
```

**Port already in use**
Change the left-side port in the relevant `ports:` entry in `docker-compose.yml`.
Default ports: `3001` (frontend), `3000` (API), `8080` (Zitadel), `6432` (PgBouncer), `5433` (Postgres direct).

**`setup.bat` fails with "network openwind_zitadel not found"**
The Zitadel project creates this shared network. Run `cd zitadel && docker compose up -d` first.

**Container keeps restarting**
Check logs: `docker compose logs -f <container-name>`

---

## Production deployment

For production, Zitadel must know it is behind HTTPS **before its very first boot**
(the issuer URL is written to the database at init time and cannot be changed without
wiping the database).

Create `zitadel/.env` on the server before starting:

```
ZITADEL_EXTERNALDOMAIN=owzitadel.yourdomain.com
ZITADEL_EXTERNALPORT=443
ZITADEL_EXTERNALSECURE=true
ZITADEL_HOST_PORT=10405
```

Create `OpenWind/.env` on the server:

```
ZITADEL_EXTERNAL_DOMAIN=owzitadel.yourdomain.com
ZITADEL_HOST_PORT=10405
ZITADEL_EXTERNALSECURE=true
ADMIN_UI_HOST_PORT=10404
```

Then run the same two-command setup. Bootstrap will generate HTTPS URLs automatically.
