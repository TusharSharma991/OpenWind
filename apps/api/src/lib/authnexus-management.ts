// Moved to packages/auth/src/authnexus-management.ts so apps/worker can reach
// it too (apps/* may only depend on packages/*, not on another app).
// Re-exported here unchanged so existing call sites and their
// vi.mock("../../lib/authnexus-management.js", ...) test mocks keep working
// without edits.
export {
  listProjectRoles,
  listOrgUsers,
  getUserById,
  invalidateUserCache,
  type OrgUser,
} from "@platform/auth";
