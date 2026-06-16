# Changelog

All notable changes to OpenWind are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed

- **API error responses** — workflow and entity engine errors now return human-readable `message` fields instead of raw error codes. Affected codes: `INSTANCE_NOT_FOUND`, `TRANSITION_NOT_AVAILABLE`, `TRANSITION_FORBIDDEN`, `TRANSITION_LOCKED`, `CONDITION_NOT_MET`, `REQUIRED_FIELDS_MISSING`, `ENTITY_NOT_FOUND`, `FIELD_VALIDATION_FAILED`, and others. Clients that match on `error` code are unaffected; clients that display `message` directly will see improved copy.

### Added

#### Admin UI

- Full admin application built with Refine + shadcn/ui:
  - Dashboard with KPI cards, module status, workflow counts, and entity-type summary
  - Workflow list with colorful per-row accents, mini state-flow visualisation, and search
  - Workflow detail — KPI strip, fields/states/transitions tables, inline editing
  - Templates (modules) page — install/uninstall modules with search and filter tabs
  - Entity type management — fields CRUD, instance list, instance detail
  - Customer records navigation — per-entity-type record lists with workflow-aware columns
  - Record detail — UX4G two-column layout, available transition buttons (previously broken), colored state badges, activity timeline
  - Dark/light theme with OS-preference detection and manual toggle
  - Responsive design at 900px / 768px / 640px / 480px breakpoints across all pages

#### Portal UI

- Customer-facing portal rebuilt from scratch:
  - Record list with workflow state badges and priority chips
  - Record detail with transition actions, field display, and activity history
  - Record create form with dynamic field rendering
  - Zitadel OIDC auth with role-based redirect (admin/agent → admin-ui, customer → portal)

#### API

- `GET /modules` — list all registered modules with per-tenant installed status
- `POST /modules/:slug/install` — install a module for a tenant (runs seed SQL)
- `POST /modules/:slug/uninstall` — uninstall a module and remove tenant config
- `GET /admin/view-configs/:entitySlug` — fetch view configuration for an entity type
- `POST /admin/view-configs/:entitySlug` — install default view configs
- `PATCH /admin/view-configs/:entitySlug` — override layout configuration
- `GET /platform/roles` — list Zitadel roles for the organisation
- `GET /platform/users` — list tenant users with display names
- `PATCH /workflows/:id` — update workflow name and active state
- `is_active` field on workflows — toggle workflows active/inactive (portal filters to active only)

#### Database

- Migration 0008 — `modules` table with RLS (tenant-scoped module registry)
- Migration 0009 — `view_configs` table with RLS (per-tenant layout overrides)
- Migration 0010 — `email` and `display_name` columns on `tenant_users`
- Migration 0011 — `is_active` boolean column on `workflows` (default `true`)

#### Modules (seed SQL)

- `helpdesk` — tickets, comments, articles, SLA workflow, automation rules, view configs
- `crm` — contacts, companies, deals, pipeline workflow
- `hrms` — employees, departments, leave requests workflow
- `reimbursements` — expense claims, approval workflow
- `projects` — tasks, milestones, project workflow
- `invoicing` — invoices, quotes, payment workflow
- `procurement` — purchase orders, vendor management, approval workflow

### Fixed

- Workflow transitions were never fetched or rendered in the customer record detail page
- Module seed registry was not auto-populated on first list request
- Helpdesk seed rewritten as a single DO block to fix install errors on Postgres simple protocol
- Type cast errors in seed SQL for Postgres simple protocol
