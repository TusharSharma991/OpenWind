## 2026-10-28 — Org chart: stale managers on re-seed, and a collapsed default

**Session type:** bug fix found on the live server (owner report: the chart showed only 4 users)
**PR:** none yet. The seeding fix belongs with #1067 (`feat/sandbox-org-seeding`), where that code lives.
**Spec:** [org-directory](../../specs/org-directory.md) R8, [multi-org-sandbox](../../specs/multi-org-sandbox.md) R3.

The API already returns the whole tree to every signed-in user; nothing filters by viewer.

| State                                 | Event                                    | Outcome                                                                                           | Kind      | Evidence                             |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- | ------------------------------------ |
| Sandbox seeded, then accounts changed | Platform admin seeds the org chart again | A top-level manager's stored manager is removed, so the three managers sit at the top as designed | fixed     | `zitadel-management.test.ts` (4 new) |
| A manager key was never set           | Seed clears it                           | Zitadel's 404 counts as already clear                                                             | fixed     | "404 on delete" test                 |
| Zitadel refuses the removal           | Seed clears it                           | Reported as a failed account, as for a failed write                                               | fixed     | "refuses the manager removal" test   |
| Organisation of 60 people or fewer    | Anyone opens the org chart               | Opens fully expanded, even for a long chain of managers                                           | changed   | `org-directory.test.tsx`             |
| Organisation of more than 60 people   | Anyone opens the org chart               | Still opens to depth 3, deeper levels expand on click                                             | unchanged | `org-directory.test.tsx`             |

**Live evidence:** the sandbox had 16 people in the tree, one directly under the root and 15 below, in a chain about 8 levels deep. All three seeded managers had a manager, which is only possible from stale values.

**Notes**

- Run the seed action again after deploying to repair an affected sandbox.
- One unrelated test in `packages/auth` (`tenant-org-lookup.test.ts`) fails against the local database's data; it is untouched by this change.
