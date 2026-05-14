# Local development setup

This guide covers platform-specific notes, troubleshooting, and the details behind each service. For the quick-start commands see the [README](../README.md#getting-started) or [CONTRIBUTING.md](../CONTRIBUTING.md#local-setup).

---

## Services

`docker compose up -d` starts these services:

| Service | Port | Purpose |
|---------|------|---------|
| Postgres 16 | 5432 | Primary database (RLS, multi-tenant) |
| Redis 7 | 6379 | BullMQ queue backend + application cache |
| MinIO | 9000 / 9001 | S3-compatible object storage. Console at :9001 |
| Zitadel | 8080 | Identity provider (OIDC/OAuth2/SAML) |
| Novu | 3003 | Notification infrastructure |
| MailHog | 1025 / 8025 | SMTP trap — catches all outbound email. UI at :8025 |
| BullBoard | 3002 | BullMQ job queue dashboard |
| OpenBao | 8200 | Secrets manager (OpenBao dev mode). Token: `dev-root-token` |

### Useful docker compose commands

```bash
docker compose up -d              # start all services in background
docker compose down               # stop all services (data preserved)
docker compose down -v            # stop all + delete all volumes (full reset)
docker compose logs -f api        # tail logs for a specific service
docker compose restart postgres   # restart one service
```

---

## Platform-specific notes

### macOS (Apple Silicon / M1, M2, M3)

All images in `docker-compose.yml` have `platform: linux/amd64` removed — they use `linux/arm64` variants where available. If you see `exec format error` on any container, check that Docker Desktop is set to use the Apple Silicon VM (not Rosetta emulation).

Postgres performance on Apple Silicon is good. MinIO and Zitadel may take slightly longer on first start while Docker pulls multi-arch images.

### Linux

Ensure your user is in the `docker` group, otherwise all `docker compose` commands need `sudo`:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

If Postgres fails to start with a permissions error on the data volume, run:
```bash
docker compose down -v && docker compose up -d postgres
```

### Windows (WSL2)

Run everything inside WSL2, not in the Windows host shell. Clone the repo inside the WSL2 filesystem (e.g., `~/projects/`), not on a Windows-mounted path (`/mnt/c/...`). File system performance on mounted paths is poor enough to make the dev server unusable.

Node.js and pnpm should be installed inside WSL2, not the Windows versions.

---

## Environment variables

Copy `.env.example` to `.env.local` before running anything:

```bash
cp .env.example .env.local
```

The defaults in `.env.example` work with the docker-compose services above — no changes needed for local development. The application reads env vars exclusively from `@platform/config` (validated with Zod at startup). If a required variable is missing or malformed, the process will refuse to start with a clear error.

### Key variables

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://platform:platform_dev_password@localhost:5432/platform` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `ZITADEL_ISSUER` | `http://localhost:8080` | Zitadel OIDC issuer |
| `ZITADEL_AUDIENCE` | `platform-api` | JWT audience claim |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO endpoint |
| `S3_BUCKET` | `platform-dev` | MinIO bucket |
| `S3_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `S3_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `NOVU_API_KEY` | *(see .env.example)* | Novu self-hosted API key |
| `OPENBAO_ADDR` | `http://localhost:8200` | OpenBao address |
| `OPENBAO_TRANSIT_KEY` | `platform-dev` | Transit encryption key name |
| `ANTHROPIC_API_KEY` | *(your key)* | Only needed if testing AI features |

`ANTHROPIC_API_KEY` is the only variable that requires a real value not provided by docker-compose. AI features will simply not work without it — the rest of the platform runs fine.

---

## Database

### Running migrations

```bash
pnpm db:migrate        # apply all pending migrations
pnpm db:rollback       # roll back the last migration
```

Migrations live in `packages/db/migrations/` as numbered SQL files (`0001_initial_schema.sql`, etc.). Each runs in a transaction — if any statement fails, the whole migration rolls back. A partial migration is a production incident; it's not possible in development by design.

### Seeding development data

```bash
pnpm db:seed           # seed tenants, entity types, sample data
```

The seed script creates:
- Two tenants: `demo-corp` (all modules installed) and `test-tenant` (blank)
- Platform admin user (credentials printed to console on first run)
- Default entity types for installed modules

### Resetting the database

```bash
docker compose down -v postgres   # deletes postgres volume
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
```

### Direct database access

```bash
docker compose exec postgres psql -U platform -d platform
```

Useful queries for development:

```sql
-- See all tenants
SELECT id, slug, status FROM tenants;

-- See entity types for a tenant
SELECT name, slug FROM entity_types WHERE tenant_id = '<uuid>';

-- See active automation rules
SELECT name, trigger_type, is_active FROM automation_rules WHERE tenant_id = '<uuid>';

-- Check RLS is working (should return empty for wrong tenant)
SET app.tenant_id = '<wrong-uuid>';
SELECT count(*) FROM entity_instances;
```

---

## Zitadel (identity)

Zitadel is the OIDC/OAuth2/SAML identity provider. In development it runs in insecure mode (no TLS).

**Console:** http://localhost:8080
**Default admin:** `admin@platform.local` / `Admin1234!`

On first boot, Zitadel seeds a `platform` organisation and an API application. The client ID and client secret are written to `.zitadel-init` (gitignored) and also set in `.env.local` by the setup script.

To create a test user:
1. Open http://localhost:8080
2. Log in as admin
3. Go to Users → New User
4. Assign the user to the `demo-corp` organisation
5. Grant roles: `agent` or `admin`

---

## OpenBao (secrets)

OpenBao runs in dev mode locally — no persistence, root token is `dev-root-token`, no unsealing required.

**UI:** http://localhost:8200 (token: `dev-root-token`)

The Transit secrets engine is auto-mounted at `transit/` and a `platform-dev` key is created by the init script. This is the key that encrypts connector credentials at rest.

In production, OpenBao runs in HA mode with auto-unseal via a cloud KMS. The dev setup intentionally does not replicate HA to keep local setup simple.

---

## Running the platform

```bash
pnpm dev               # start all apps with hot reload (Turbo watch)
```

Or start individual apps:

```bash
pnpm --filter @platform/api dev       # API only (port 3000)
pnpm --filter @platform/worker dev    # worker only
pnpm --filter @platform/admin-ui dev  # admin UI only (port 3001)
pnpm --filter @platform/portal dev    # portal only (port 3004)
```

### Port reference

| App | Port |
|-----|------|
| API | 3000 |
| Admin UI | 3001 |
| BullBoard | 3002 |
| Novu | 3003 |
| Portal | 3004 |

---

## Troubleshooting

### `pnpm install` fails

Ensure you're running Node.js 22+ and pnpm 9+:
```bash
node --version   # should be 22.x
pnpm --version   # should be 9.x
```

If the lockfile is out of sync: `pnpm install --frozen-lockfile=false`

### `pnpm dev` — "Cannot connect to database"

Postgres may not be ready yet. Wait a few seconds and retry, or check:
```bash
docker compose ps postgres   # should show "healthy"
```

### `pnpm dev` — Zitadel JWT validation fails

Zitadel takes ~15 seconds to fully start. The API retries JWKS fetching on startup, but if you start `pnpm dev` before Zitadel is ready you may need to restart the API:
```bash
docker compose ps zitadel   # wait until healthy
pnpm --filter @platform/api dev
```

### Port already in use

If something is already on port 5432/6379/8080 etc.:
```bash
lsof -i :5432    # find what's using the port
```
Or change the host port in `docker-compose.yml` (the left side of `ports:`).

### Full reset

When in doubt, a full reset takes about 2 minutes:
```bash
docker compose down -v
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```
