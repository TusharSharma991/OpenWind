# Lens 3 — Expert UX Designer: Adoption & Friction Review

**Document type:** External code-level review (independent)  
**Status:** Delivered 2026-06-23  
**Reviewer:** Arijeet Chakravarty  
**Lens:** Expert UX designer — remove the friction that blocks adoption.  
**Method:** Source review of `apps/admin-ui`, `apps/portal`, `packages/ui`, the onboarding/bootstrap path, and design tokens.

> One of three independent lenses in this external review — CTO (architecture & risk), Product (capability & roadmap), and UX (adoption). Each document stands alone.

## Executive summary — would a user love this today?

Mostly yes for the admin, qualified yes for the end-user portal. This is **not** a thin scaffold — it is a genuinely built product. The core loops an evaluator cares about all exist as real, wired UI: a one-command bootstrap that reaches a logged-in screen, a working record list → record detail → workflow-transition flow with a confirmation modal and an activity timeline, a real **drag-and-drop visual workflow builder** (ReactFlow, states + transitions + SLA + colors, dirty-tracking, localStorage layout), a 4-step automation wizard, and a custom-field configurator. Empty/loading states are handled almost everywhere. For a self-hosted OSS product, the first-run experience is well above average.

What stops it short of "love" is **polish debt that compounds at scale**: there is effectively no shared component library, two hand-written CSS files (2,839 + 1,312 lines) duplicate the design system, accessibility is shallow (no dialog semantics on any modal, keyboard gaps), there is **zero i18n** despite multi-tenant positioning, several configurable field types render as plain text inputs in the portal, and the admin and portal login screens look like two different products. A power user/admin will be productive and impressed; a non-technical end user will succeed at the common path but hit rough edges; an accessibility-dependent or non-English user will struggle.

Verdict: a strong, lovable-by-admins product with a maintainability/consistency time bomb and an a11y/i18n gap that will bite as adoption widens.

## UI surface inventory (what actually exists)

**Two Vite + React 18 + TypeScript SPAs.** Admin uses Refine (`@refinedev/core`) for auth/data/routing; portal is plain React Router. Auth is OIDC via Zitadel (`oidc-client-ts`) in both.

**`packages/ui` — the "shared UI" is hollow.** It contains exactly two files: `src/index.ts` and `src/utils.ts`, exporting only `cn()` (clsx + tailwind-merge). There are **no shared components** — no Button, Modal, Input, Table. `class-variance-authority` and `tailwind-merge` are dependencies but **Tailwind is not actually used**; styling is hand-rolled CSS classes + heavy inline styles. Every screen reinvents its buttons, modals, and chips. (`packages/ui/src/index.ts`, `packages/ui/package.json`)

**Admin UI (`apps/admin-ui/src`, 42 files), routes from `App.tsx`:**

- `/` Dashboard (real KPIs + workflow-performance table, fetches live data — `pages/dashboard.tsx`, 1,146 lines)
- `/modules` "Templates" — browse + fork prebuilt modules (`pages/modules.tsx`)
- `/records` workflow cards → `/records/:typeSlug` customer-style list/create/detail (`pages/customer/*`, record-list 1,806 lines)
- `/workflows` list → `/workflows/:slug` detail with **Canvas + Pipeline** builder (`components/workflow-canvas.tsx`, 1,427 lines) → `/workflows/new`
- `/entity-types/:id` field configurator + enum builder (`pages/entity-types/detail.tsx`)
- `/automations` rules table → `/automations/new` 4-step wizard (`pages/automations/wizard/*`)
- `/settings` theme + accent picker (`pages/settings.tsx`)

**Portal (`apps/portal/src`, 15 files):** login, callback, dashboard, settings, and `:typeSlug` list/new/:id. The record list (`pages/records/list.tsx`, 857 lines) includes search, saved views, and CSV/XLSX/PDF export with async polling toasts. The record detail (`pages/records/detail.tsx`, 725 lines) is the end-user workflow surface: field view/edit, transition buttons → confirmation modal with required-comment gating, and an activity timeline.

**Design tokens:** CSS custom properties (`--bg-primary`, `--text-primary`, `--accent-primary`, etc.) with a JS-driven theme system (`apps/admin-ui/src/lib/theme.ts`): dark/light mode + 8 accent colors, derived secondary/hover/focus shades computed in HSL, persisted to localStorage. Tokens are **duplicated** across the two apps' CSS rather than shared — drift is guaranteed over time.

## Onboarding / first-run friction

**This is the strongest part of the product.** Happy path is genuinely ~4 commands:

1. `git clone …` → 2. `cd OpenWind` → 3. `pnpm install --frozen-lockfile` → 4. `pnpm bootstrap`

`scripts/bootstrap.ts` then runs 10 automated steps: preflight (Node 22+, pnpm 9+, Docker), `.env.local` from `.env.example`, `docker compose up` (6 core services), health-wait, migrations + seed, **fully headless Zitadel setup** (reads the machine key from container logs, JWT-Profile-Grant auth, creates project/OIDC app/roles/3 demo users via API), and template seeding. No manual Zitadel console steps, no hand-pasted client IDs/secrets. Demo creds are printed: `owAdmin / owAgent / owUser` @ `OpenWind1234!`. Docker footprint (~2–3 GB) runs comfortably on a laptop. Docs (`README.md`, `docs/local-setup.md`) are clear and have a real troubleshooting section.

**Foot-guns (ranked):**

1. **`docker compose down` vs `down -v`** — plain `down` keeps the Postgres volume; re-running bootstrap then mixes stale Zitadel org data and conflicts. Easy to hit, painful to diagnose.
2. **Frontend env re-read** — `ZITADEL_OIDC_CLIENT_ID` is read at container start; if written after the admin-ui container boots you must `docker compose up -d --force-recreate admin-ui` (a plain `docker restart` won't re-read it).
3. **6 fixed ports** (3001/3000/8080/5432/6432/6379) with no pre-flight collision check — silent failure if occupied.
4. **PgBouncer transaction-mode RLS** — bypassing PgBouncer breaks tenant scoping silently (wrong tenant's data).
5. **Doc drift** — README mentions "5 sample tickets" but the seed only creates templates; a fresh login lands on **empty** workspaces, so the very first screen a new user sees is an empty state, not populated demo data. That undercuts the "wow" moment the rest of onboarding earns.

Net: low friction to a logged-in screen; the gap is that the logged-in screen is empty, so first-run doesn't _show off_ the product.

## Flow-by-flow friction findings

**End-user: work a record (portal) — good.** List → row click → detail → "Move to" button → confirmation modal (shows from→to badges, comment field gated by `requiresComment`) → reloads with updated state + timeline entry. Clear, few clicks, real feedback. Frictions: the whole `<tr>` is click-to-navigate but there is **no keyboard handler** on the row (mouse-only); the transition modal has no `role="dialog"`, no focus trap, no Escape-to-close (only overlay click + ×).

**End-user: create/edit a record — partial.** `FieldInput` (`portal/.../detail.tsx:98`) only renders sensible inputs for text/number/date/boolean/enum/longtext. The field-type catalog offers **15 types** including `file`, `files`, `user_ref`, `entity_ref`, `formula`, `lookup` (`entity-types/detail.tsx:37`) — but all of these fall through to a **plain text input** in the portal. So an admin can configure a "file attachment" or "assignee" field and the end user gets a bare text box. This is the single biggest _functional_ UX gap: the config surface promises capabilities the data-entry surface doesn't deliver.

**Admin: configure a custom field — good but inconsistent.** Add-field modal auto-derives snake*case `name` from the label, validates the pattern, includes a live enum-options builder with auto-generated keys. But field **delete uses native `confirm()` and `alert()`** (`entity-types/detail.tsx:256,519`) — jarring browser dialogs, while \_every other* destructive action in the app uses a styled custom modal. Clear inconsistency.

**Admin: build a workflow — strong.** `workflow-canvas.tsx` is a true builder: double-click to add states, drag handle-to-handle to create transitions, edge/node click to edit, Delete key to remove (with cascade warning), dagre auto-layout + "Reset layout", dirty indicator (●) + `beforeunload` guard, localStorage-persisted positions. Falls back to a Pipeline view above 20 states / 40 transitions. This is paid-grade.

**Admin: automation wizard — good.** 4 steps (Trigger → Conditions → Actions → Save) with a stepper, per-step `canAdvance` gating, edit-mode hydration. URL `id` param is UUID-validated before use. Clean.

**Admin: dashboard — real, not a stub.** Live KPIs, clickable cards, workflow-performance table with inline bars, recent records. Missing an explicit error state if the fetch fails (silently empties).

## Accessibility & polish audit

- **Modals: no dialog semantics anywhere.** Zero `role="dialog"` / `aria-modal` across both apps. No focus trapping, no focus return, and Escape is handled in exactly **one** file (`modules.tsx`). Transition-confirm, save-view, add/edit-field modals are all keyboard-incomplete.
- **Thin ARIA overall:** ~38 aria attributes total in the entire front-end (26 `aria-hidden` on icons, 9 `aria-label`, 3 `aria-pressed`). Custom dropdowns (Views, Export format) are built from `<div onClick>` — not keyboard-operable.
- **Inconsistent keyboard support:** `workflows/index.tsx` rows support Enter/Space; the portal record rows (same pattern) do not. No shared primitive means each surface re-decides a11y.
- **`focus-visible`** appears in only a handful of CSS selectors — most interactive elements have no visible focus ring.
- **No `prefers-reduced-motion`** (animations like `popup-in`, spinners always run) and **no `prefers-color-scheme`** — theme is JS-only, so there's a flash-of-wrong-theme risk before hydration.
- **i18n: none.** No i18n library, all strings hardcoded English, `lang="en"` fixed. Not translation-ready despite the multi-tenant story.
- **Styling architecture is inconsistent:** CSS classes + pervasive inline styles + an injected `<style>` block inside `record-list.tsx` (lines 818–854). Three styling mechanisms in one file.
- **Brand/polish inconsistency:** admin login (`admin-ui/.../login.tsx`) is a full polished landing page (topbar, theme toggle, footer, security badge); portal login (`portal/.../login.tsx`, 28 lines) is a bare card. Logos differ ("W" vs "OW"). Two products, one repo.
- **Responsive:** admin has 23 media queries (down to 360px), portal only 5 — the portal is less hardened on small screens.
- **Naming friction:** nav label "Templates" → route `/modules` → action "Fork" (`modules.tsx`); plus conceptual overlap between "Records" and "Workflows" tabs. Vocabulary isn't fully settled for a non-technical user.

## Ranked adoption-killers

1. **Configured-but-non-functional field types in the portal** — file/user/entity-ref/formula/lookup fields render as plain text. Admins build forms that silently don't work for end users. (`portal/src/pages/records/detail.tsx:98`)
2. **No accessibility floor on modals/menus** — no dialog roles, no focus trap, Escape only in one place, mouse-only dropdowns/rows. Blocks keyboard and screen-reader users outright and fails any procurement a11y check.
3. **Zero i18n** — instant disqualifier for non-English orgs; expensive to retrofit later because every string is inline.
4. **Empty first-run workspace** — onboarding nails the install but drops the user on empty states; README's "sample tickets" don't exist. The demo doesn't demo.
5. **No shared component library (`packages/ui` is just `cn()`)** — guarantees admin/portal drift (two logins already prove it) and multiplies the cost of fixing 1–3 everywhere.
6. **Inconsistent destructive UX** — native `confirm()`/`alert()` in field management vs. styled modals elsewhere erodes the "polished product" trust.
7. **Reset foot-gun (`down` vs `down -v`)** — the one operator trap most likely to make a self-hoster rage-quit on their second attempt.

## Quick UX wins (cheapest fixes, biggest love-payoff)

- **Seed real demo data** (5 tickets, a CRM contact, an HRMS request) in `seed-demo.ts` so first login is populated. Highest wow-per-line-of-code; also makes the README honest.
- **Build 3 shared primitives in `packages/ui`** — `Modal` (with `role="dialog"`, `aria-modal`, focus trap, Escape), `Menu`/`Dropdown`, `Button` — and swap them in. Fixes adoption-killers #2 and #5 at the root and stops future drift.
- **Replace the native `confirm()`/`alert()`** in `entity-types/detail.tsx` with the existing custom confirm modal pattern (already used in workflows/automations). One file, removes a glaring inconsistency.
- **Render the remaining field types** — at minimum a file upload, a user picker, and an entity-ref select in `FieldInput`. Closes the most damaging functional gap.
- **Unify the two logins** — point the portal at the admin login's component/styles. Cheap consistency that immediately reads as "one product."
- **Add `prefers-reduced-motion` + a global `:focus-visible` ring** in both CSS roots — two small blocks, broad a11y/polish lift.
- **Document the reset** prominently (`down -v`) and add a `pnpm reset` script wrapper (already partially in `scripts/reset-data.ts`) to remove the foot-gun.
- **Rename for clarity** — pick "Templates" or "Modules" and use it consistently in nav, route, and button copy.

## Overall UX / adoption rating: **7 / 10**

A real, polished, surprisingly complete product with best-in-class self-host onboarding and a genuine visual workflow builder — well past prototype. It loses three points to **shallow accessibility (no dialog semantics, keyboard gaps), no i18n, a hollow shared-UI layer that's already causing admin/portal drift, portal field types that don't render, and an empty first-run that wastes a great install flow.** Land the quick wins above — especially shared primitives, real seed data, and the missing field inputs — and this is an honest 8.5–9.
