# Local development setup

This guide covers platform-specific notes, troubleshooting, and the details
behind each service. For the quick-start commands see the
[README](../README.md#getting-started).

---

## Services

`docker compose up -d` starts these services:

| Service     | Port | Purpose                                                                               |
| ----------- | ---- | ------------------------------------------------------------------------------------- |
| Postgres 16 | 5432 | Primary database (RLS, multi-tenant). **Never connect here directly** — use PgBouncer |
| PgBouncer   | 6432 | Connection pooler (transaction mode). App always connects here                        |
| Redis 7     | 6379 | BullMQ queue backend + application cache                                              |
| Zitadel     | 8080 | Identity provider (OIDC/OAuth2). Console at http://localhost:8080                     |
| API         | 3000 | Hono API server                                                                       |
| Admin UI    | 3001 | React app (Vite dev server with HMR)                                                  |

**Commented out** (not yet integrated — uncomment in `docker-compose.yml` when needed):

| Service | Port        | Purpose                                                          |
| ------- | ----------- | ---------------------------------------------------------------- |
| OpenBao | 8200        | Secrets manager (enable when Transit encryption is wired in)     |
| MinIO   | 9000 / 9001 | S3-compatible storage (enable when `packages/files` is wired in) |

**Optional profiles** (start with `--profile <name>`):

| Profile         | Services added                          |
| --------------- | --------------------------------------- |
| `notifications` | Novu API, worker, web, MongoDB          |
| `tools`         | MailHog (email trap), BullBoard (queue) |

### Useful docker compose commands

```bash
docker compose up -d                        # start core services
docker compose down                         # stop (data preserved)
docker compose down -v                      # stop + wipe all volumes (full reset)
docker compose logs -f api                  # tail logs for a service
docker compose restart ow-frontend          # restart one container
docker compose --profile tools up -d       # start with optional tools
```

---

## Platform-specific notes

### macOS (Apple Silicon)

All images use multi-arch variants. If you see `exec format error` on any
container, ensure Docker Desktop is set to use the Apple Silicon VM (not
Rosetta emulation).

### Linux

Ensure your user is in the `docker` group:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

If Postgres fails to start with a permissions error on the data volume:

```bash
docker compose down -v && docker compose up -d
```

### Windows

Run `pnpm bootstrap` from either PowerShell or Git Bash — both work. Docker
Desktop must be running. No WSL2 required; everything runs in Docker containers.

---

## Environment variables

`pnpm bootstrap` creates `.env.local` from `.env.example` automatically.
The defaults work with the docker-compose services with no manual edits.

### Key variables

| Variable                 | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `DATABASE_URL`           | App connection (via PgBouncer port 6432, as `app_user`)                       |
| `MIGRATION_DATABASE_URL` | Migration connection (direct Postgres port 5432, as `migration_user`)         |
| `ZITADEL_ISSUER`         | Zitadel OIDC issuer URL                                                       |
| `ZITADEL_OIDC_CLIENT_ID` | Written by `pnpm bootstrap` — do not set manually                             |
| `ZITADEL_KEY_JSON`       | Service account key for headless M2M auth — written by bootstrap on first run |
| `ANTHROPIC_API_KEY`      | Only needed for AI features — rest of platform works without it               |

**Why two database URLs?**
`app_user` connects via PgBouncer in transaction mode, which is required for
`SET LOCAL` RLS scoping to work correctly. `migration_user` bypasses PgBouncer
and connects directly to Postgres because DDL operations (CREATE TABLE, ALTER)
cannot run inside PgBouncer transaction mode. The two users have different
Postgres privileges: `app_user` is subject to RLS and has DML only;
`migration_user` owns the schema and can bypass RLS.

---

## Database

### Running migrations

```bash
pnpm db:migrate        # apply all pending migrations (uses MIGRATION_DATABASE_URL)
```

Migrations live in `packages/db/migrations/` as numbered SQL files. Each runs
in a transaction. Adding a new migration file also requires updating
`packages/db/migrations/meta/_journal.json` — Drizzle's migrator reads the
journal to determine which files to apply.

### Seeding

```bash
pnpm db:seed           # seed base tenant (idempotent — safe to re-run)
pnpm seed:demo         # seed Helpdesk demo data (entity type, workflow, 5 tickets)
```

Both are run automatically by `pnpm bootstrap`. Re-running them after a reset
is safe — inserts use `ON CONFLICT DO NOTHING`.

### Resetting the database

```bash
docker compose down -v          # wipes postgres volume
rm .env.local                   # removes generated credentials
pnpm bootstrap                  # full setup again (fully automated)
```

> Always use `docker compose down -v` before re-bootstrapping. Without `-v`,
> the old Postgres data persists and the new Zitadel setup collides with it.

### Direct database access

```bash
docker compose exec postgres psql -U platform -d platform
# or as the app user:
docker compose exec postgres psql -U app_user -d platform
```

Useful queries:

```sql
-- See all tenants
SELECT id, slug, status FROM tenants;

-- See entity types for the dev tenant
SELECT name, slug FROM entity_types
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- Check which migrations have been applied
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;

-- Verify is_active column on workflows (sanity check)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'workflows';
```

---

## Zitadel (identity)

Zitadel is the OIDC/OAuth2 identity provider. In development it runs without TLS.

**Console:** http://localhost:8080  
**System admin:** `admin@platform.local` / `Admin1234!`

`pnpm bootstrap` creates the `Platform` project, OIDC app, three demo users,
and writes `ZITADEL_OIDC_CLIENT_ID` and `ZITADEL_KEY_JSON` to `.env.local`.

Demo login usernames: `owAdmin`, `owAgent`, `owUser` — password `OpenWind1234!` for all.
(Full emails also work: `owAdmin@openwind.local`, etc.)

Bootstrap reads the Zitadel setup PAT automatically from the container — no
manual browser step required. After bootstrap runs, the frontend and API
containers are force-recreated so both pick up the new OIDC credentials.

If you ever change Zitadel credentials manually, force-recreate the frontend:
`docker compose up -d --force-recreate admin-ui`.

---

## Troubleshooting

### Login fails with `client_id` error

The frontend Vite server reads `.env.local` at startup. If `ZITADEL_OIDC_CLIENT_ID`
was written to `.env.local` after the container started, force-recreate it:

```bash
docker compose up -d --force-recreate admin-ui
```

Note: `docker restart` and plain `docker compose up -d` do NOT re-read `env_file`
when the compose config itself hasn't changed. Always use `--force-recreate` to
guarantee the container picks up new env values.

### All API requests return 401 after login

The API container has a stale `ZITADEL_AUDIENCE` value from before bootstrap
wrote the real project ID. Recreate it:

```bash
docker compose up -d api
```

Same root cause as above — `docker restart ow-backend` will not help.

### Migration fails: `permission denied for database platform`

The `DATABASE_URL` uses `app_user` which lacks DDL privileges. Migrations must
use `MIGRATION_DATABASE_URL`. Check that `.env.local` has this line:

```
MIGRATION_DATABASE_URL=postgresql://migration_user:migration_user_dev_password@localhost:5432/platform
```

If missing, add it. It is present in `.env.example` and auto-copied by bootstrap.

### Seed fails: `column "is_active" does not exist`

Migration `0011_workflow_is_active.sql` was not applied. Check the journal:

```bash
cat packages/db/migrations/meta/_journal.json
```

The journal must include entries for `0010_tenant_users_profile` and
`0011_workflow_is_active`. If missing, pull the latest `tushar` branch and
re-run `pnpm db:migrate`.

### `seed:demo` fails: `Cannot find module '@platform/db/dist/index.js'`

Internal packages need to be built before scripts can import from them.
Run manually:

```bash
pnpm turbo run build --filter=@platform/config --filter=@platform/db
pnpm seed:demo
```

This is now handled automatically by `pnpm bootstrap`.

### Old Zitadel users appearing after a fresh setup

You ran `docker compose down` without `-v`. The Postgres volume was preserved,
so the old Zitadel data is still there. Fix:

```bash
docker compose down -v
rm .env.local
pnpm bootstrap
```

### Postgres healthcheck fails / PgBouncer won't start

Postgres takes 10–20s on first boot while it runs `initdb`. Wait for it:

```bash
docker compose ps          # watch until ow-database shows "healthy"
docker compose logs postgres --tail=30
```

### Port already in use

```bash
# macOS/Linux
lsof -i :3001
# Windows PowerShell
netstat -ano | findstr :3001
```

Change the conflicting host port in `docker-compose.yml` (left side of `ports:`).
