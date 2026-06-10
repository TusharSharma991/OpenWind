// The tenant status cache lives in @platform/auth so that the auth middleware
// and the lifecycle service share the same module instance.
// This file is intentionally empty — import from "@platform/auth" directly.
export { invalidateTenantStatusCache } from "@platform/auth";
