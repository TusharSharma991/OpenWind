import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { createRelationHandler } from "./create-relation.js";
import { listRelationsHandler } from "./list-relations.js";
import { deleteRelationHandler } from "./delete-relation.js";
import { searchEntitiesHandler } from "./search.js";
import { bulkCreateHandler } from "./bulk-create.js";
import { bulkUpdateHandler } from "./bulk-update.js";
import { bulkSetStateHandler } from "./bulk-set-state.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/search", ...searchEntitiesHandler);

// Bulk routes — rate-limited to 10 req/min at the gateway layer
router.post("/bulk", ...bulkCreateHandler);
router.patch("/bulk", ...bulkUpdateHandler);
router.post("/bulk/state", ...bulkSetStateHandler);

router.post("/:id/relations", ...createRelationHandler);
router.get("/:id/relations", ...listRelationsHandler);
router.delete("/:id/relations/:relationId", ...deleteRelationHandler);

export { router as entitiesRouter };
