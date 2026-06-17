# OpenWind Setup Guide

Get OpenWind running from scratch in about 5 minutes.

---

## What you need

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- Git
- A terminal (PowerShell, Terminal.app, bash — all work)

No Node.js, pnpm, or anything else required on your machine. Everything runs inside Docker.

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/your-org/openwind.git
cd openwind
```

---

## Step 2 — Create your local env file

Copy the example env file. The defaults work for local development — you do not need to edit anything.

```bash
cp .env.example .env.local
```

> `.env.local` is gitignored. It holds your local overrides and the Zitadel key that bootstrap saves after first run.

---

## Step 3 — Start the services

This starts Postgres, Redis, Zitadel (identity provider), MinIO (file storage), the API, and the admin UI.

```bash
docker compose up -d
```

First run pulls images — takes 2–3 minutes. Subsequent starts take about 10 seconds.

---

## Step 4 — Run the bootstrap script

```bash
docker compose --profile bootstrap run --rm bootstrap
```

The script runs inside Docker. It will:

1. Wait for all services to be healthy
2. Run database migrations
3. Seed a demo tenant
4. Walk you through a one-time Zitadel setup (see step 5 below)
5. Create demo users
6. Print login credentials when done

> On re-runs (after a wipe or on another machine) bootstrap skips everything that's already done.

---

## Step 5 — Create a Personal Access Token (one time only)

When bootstrap reaches **step 7**, it pauses and asks you to create a Personal Access Token for the `setup-admin` service user. Follow these steps:

**1.** Open the Zitadel console in your browser: **http://localhost:8080**

**2.** Log in with the system admin account:

- Username: `owZitadelAdmin@openwind.local`
- Password: `Admin1234!`

**3.** In the left sidebar click **Organization**, then open the **Users** page.

**4.** Click the **Service Users** tab, then click on the **setup-admin** user.

**5.** In the left menu select **Personal Access Tokens**, click **+ New**, leave expiry **empty**, click **Add**.

**6.** Copy the token that appears in the dialog — it is shown **only once**.

**7.** Paste the token into the terminal and press Enter.

The token is saved to `.env.local` automatically as a key JSON. Future bootstrap runs (e.g. after a code update) skip this step entirely and run headless.

---

## Step 6 — Restart app containers

After bootstrap finishes it prints credentials and a reminder to restart:

```bash
docker compose restart ow-backend ow-frontend
```

This is required because the API and frontend containers started before bootstrap wrote the Zitadel credentials to `.env.local`. The restart picks up the new `ZITADEL_OIDC_CLIENT_ID` and `ZITADEL_AUDIENCE` values — without it the login button throws a `client_id` error.

---

## Step 7 — Open OpenWind

Open [http://localhost:3001](http://localhost:3001). Bootstrap printed the credentials:

```
Login accounts

  OpenWind Admin  (full platform access)
    Username:  owAdmin
    Password:  OpenWind1234!

  Portal User  (end-user view)
    Username:  owUser
    Password:  OpenWind1234!
```

Open [http://localhost:3001](http://localhost:3001) and log in with any of the accounts above.

---

## Step 7 — Load module templates

Module templates (CRM, Helpdesk, HRMS, etc.) auto-seed on the first visit to the **Templates** page — no action needed. If the list appears empty, click **Seed Templates** to trigger it manually.

---

## Common commands

| Task                            | Command                                                 |
| ------------------------------- | ------------------------------------------------------- |
| Start services (after reboot)   | `docker compose up -d`                                  |
| Stop services                   | `docker compose down`                                   |
| View logs                       | `docker compose logs -f`                                |
| Rebuild after code changes      | `docker compose up -d --build`                          |
| Wipe everything and start fresh | `docker compose down -v` then repeat from Step 3        |
| Re-run bootstrap only           | `docker compose --profile bootstrap run --rm bootstrap` |

---

## Ports

| Service            | URL                   |
| ------------------ | --------------------- |
| OpenWind Admin UI  | http://localhost:3001 |
| API                | http://localhost:3000 |
| Zitadel (identity) | http://localhost:8080 |
| MinIO console      | http://localhost:9001 |

---

## Troubleshooting

**Bootstrap says "Zitadel is not ready" and times out**
Zitadel can take 60–90 seconds on first boot while it initialises its database. Re-run bootstrap: `docker compose --profile bootstrap run --rm bootstrap`.

**"Instance not found" error when pasting the PAT**
The PAT was created against a different Zitadel instance (e.g. after a volume wipe). Wipe and start fresh: `docker compose down -v` then repeat from Step 3.

**The admin UI shows a blank screen or auth error**
The API may still be starting. Wait 10 seconds and refresh. If it persists, check `docker compose logs ow-api`.

**Port already in use**
Another service is using 3001, 3000, or 8080. Stop the conflicting service, or change the ports in `.env.local`:

```
ADMIN_UI_HOST_PORT=3002
ZITADEL_HOST_PORT=8081
```

Then re-run `docker compose up -d`.
