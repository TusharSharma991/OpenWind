# Skill: authnexus-pull-guard

Safely pull/merge/rebase changes from another branch (`main`, `upstream/main`, any
feature branch) into `authnexus-integration` without silently reintroducing Zitadel
auth, breaking the AuthNexus wiring, or colliding with the OSS stack running
alongside this one on the same host.

This branch swapped Zitadel for AuthNexus as the OIDC provider. That swap touched
auth-adjacent code scattered across the whole repo, not one isolated module — so a
plain `git merge`/`git pull` can reintroduce the old behavior even when it applies
cleanly with zero conflicts. Conflicts are the easy case; **silent semantic drift is
the dangerous one**.

---

## When to use

Invoke this **every time** before/during/after:

- `git pull`, `git fetch` + `git merge`, or `git rebase` bringing in commits from
  another branch (local or remote) into this worktree
- The user says "pull this branch", "merge main into this", "bring in the latest
  from upstream", or similar
- Cherry-picking a commit from `main`/`upstream/main`/another feature branch

Do **not** skip this because the merge reports "no conflicts" — every real incident
found so far merged/applied cleanly and still broke the app.

---

## Why this is risky — the actual incidents this branch already hit

1. **Audience/claim-shape mismatch** — assumed AuthNexus reused Zitadel's
   `urn:zitadel:iam:*` claim namespace because its OIDC _scope names_ look
   Zitadel-derived. Wrong. Real tokens are flat: `org_id`, `project_id`,
   `nexus_projects[].roles`. `aud` is the OIDC client id, not a Zitadel-style
   project urn. This broke JWT verification (401) until fixed.
2. **Six duplicated copies of the same stale claim-parsing logic** — one bug fixed
   in `authProvider.ts` did not fix the app, because `layout.tsx`,
   `workflows/detail.tsx`, `records/workflow-records.tsx`, `records/index.tsx`,
   `dashboard.tsx`, `callback.tsx`, and `customer/record-detail.tsx` each had their
   own copy-pasted `urn:zitadel:iam:org:project:roles` parse. Any new page that
   reads `user.profile[...]` directly for roles is likely another copy of this.
3. **Removed introspection entirely** — `requireIntrospection`/`introspection.ts`
   no longer exist (AuthNexus has no introspection endpoint). A new route added
   upstream that imports `requireIntrospection` will fail to compile — that's the
   _good_ outcome (loud). The bad outcome is a route that re-implements a similar
   check against a Zitadel endpoint that no longer exists.
4. **`zitadel-management.ts` → `authnexus-management.ts`** — different signatures
   (`listOrgUsers`/`listProjectRoles` now take a `bearerToken`, no service
   account), different backing endpoint (`/api/admin/projects/{id}/assignments`,
   not `/api/admin/users`). Upstream code that still imports the old module name
   or old function signatures will fail to compile — good. Upstream code that
   copies the _pattern_ (e.g. a new feature calling Zitadel's Management API
   directly) will compile fine and silently be wrong.
5. **Docker Compose / port isolation** — this branch renamed the project
   (`openwind-authnexus`), every `container_name` (`aw-*` prefix), and every host
   port (`10406`–`10411` range) specifically so it can run alongside the OSS
   Zitadel-based stack (`ow-*`, default ports) on the same host. A naive merge of
   `docker-compose.yml` from upstream can silently revert names/ports back to the
   colliding defaults, or reintroduce the `openwind_zitadel` external network /
   `zitadel` service.
6. **Env var drift** — `ZITADEL_*` → `AUTHNEXUS_*` throughout `.env`,
   `.env.example`, `packages/config/src/env.ts`, and every `vitest.config.ts`
   env stub. `.env.local` (the file with real secrets/IDs) is gitignored, so it
   is **never touched by a merge** — any new required var upstream adds to
   `.env.example`/`env.ts` will be silently missing from the running `.env.local`
   until you add it by hand.
7. **Unrelated-looking schema bugs surface once you actually click through the
   app** — e.g. a mention-level enum mismatch (`read_write` vs
   `read_only`/`read_comment`) that had nothing to do with auth but only showed up
   once real login worked. Don't assume "auth-only" — verify the golden paths.

---

## Procedure

### 1. Before merging — diff the landmine files first

```bash
git fetch origin upstream          # or whichever remotes are relevant
git diff HEAD...<incoming-ref> --stat -- \
  packages/auth/ \
  packages/config/src/env.ts \
  apps/api/src/lib/authnexus-management.ts \
  apps/api/src/lib/zitadel-management.ts \
  apps/admin-ui/src/authProvider.ts \
  docker-compose.yml .env .env.example \
  '**/vitest.config.ts'
```

If any of these appear, read the actual diff (`git diff HEAD...<incoming-ref> -- <file>`)
before merging, not after. Know what's changing in auth-adjacent territory ahead of
time.

### 2. Do the merge/rebase

Normal git conflict resolution applies. When resolving:

- **Keep this branch's version** for: `AUTHNEXUS_*` env vars/config, JWKS-only
  verification in `jwks.ts`, `authnexus-management.ts`, Docker Compose
  identifiers (project name, `aw-*` container names, `10406`-`10411` ports),
  `getRolesFromProfile()` and its call sites.
- **Take upstream's version** for everything else (business logic, UI features,
  non-auth routes, migrations) — that's the whole point of tracking upstream.

### 3. After merging — grep for regressions (do this even with zero conflicts)

```bash
# Any of these matching = a new copy of the stale-claim bug, or a reintroduced
# Zitadel dependency that needs redirecting to the AuthNexus equivalent.
grep -rn "urn:zitadel:iam" apps/ packages/ --include="*.ts" --include="*.tsx"
grep -rn "ZITADEL_" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v "\.test\.ts"
grep -rn "requireIntrospection\|zitadel-management" apps/ packages/
grep -n "openwind_zitadel\|container_name: ow-\|name: openwind$" docker-compose.yml
```

Every hit needs a decision, not a reflexive revert — check whether it's new
upstream code that needs the AuthNexus equivalent wired in, or genuinely dead
code that's safe to ignore.

### 4. Sync `.env.local` by hand

```bash
diff <(grep -oE '^[A-Z_]+=' .env.example | sort) \
     <(grep -oE '^[A-Z_]+=' .env.local | sort)
```

Anything in `.env.example` but missing from `.env.local` needs a real value added
before the stack will boot — `env.ts`'s Zod schema fails closed on missing
required vars, so this surfaces as a boot crash, not a silent bug. Still check it
first rather than debugging the crash from scratch.

### 5. Rebuild, typecheck, lint, test — in that order

```bash
pnpm --filter <touched-packages> build
pnpm --filter <touched-packages> typecheck
npx eslint <touched-files>
pnpm --filter <touched-packages> test
```

Don't skip straight to `docker compose up` — a stale `dist/` from an unbuilt
dependency produces confusing "Cannot find module" errors that look unrelated to
the merge.

### 6. Rebuild and restart the actually-running containers

```bash
docker compose up -d --build ow-backend ow-frontend
docker logs aw-backend --tail 30     # confirm clean boot, no env-validation crash
```

### 7. Manually re-verify the golden paths — every time

Automated tests won't catch claim-shape drift (they mock `@platform/config`, so a
real AuthNexus response shape mismatch never shows up in `vitest`). After every
pull, actually click through:

- Login → callback → landing page (no redirect loop, no 401)
- Profile badge shows the right role label (not "Customer" for an admin)
- Sidebar shows the right nav items for the role
- Open a workflow's detail page (role-gated access check)
- Post a comment, including one that `@mentions` someone who already has
  standing access
- `GET /roles`, `GET /users` return real data, not just the hardcoded fallback

If any of these regress after a clean merge with no conflicts, that's the
signature of this branch's specific failure mode — go back to step 3's grep.

---

## Red flags to avoid

- Treating "merged with no conflicts" as "verified working"
- Fixing a claim-shape bug in one file and assuming it's fixed everywhere
- Reverting a docker-compose.yml conflict by blindly taking "theirs" (upstream) —
  check it didn't reintroduce Zitadel services or default ports first
- Adding a new required env var to `env.ts`/`.env.example` without also updating
  `.env.local` in this worktree
- Assuming a schema/validation error is auth-related just because this branch's
  history is mostly auth fixes — verify against the actual error before assuming
