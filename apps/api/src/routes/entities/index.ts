import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { createRelationHandler } from "./create-relation.js";
import { listRelationsHandler } from "./list-relations.js";
import { deleteRelationHandler } from "./delete-relation.js";
import { searchEntitiesHandler } from "./search.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.get("/search", ...searchEntitiesHandler);
router.post("/:id/relations", ...createRelationHandler);
router.get("/:id/relations", ...listRelationsHandler);
router.delete("/:id/relations/:relationId", ...deleteRelationHandler);

export { router as entitiesRouter };
