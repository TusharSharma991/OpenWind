import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { createEntityTypeHandler } from "./create.js";
import { listEntityTypesHandler } from "./list.js";
import { getEntityTypeHandler } from "./get.js";
import { updateEntityTypeHandler } from "./update.js";
import { deleteEntityTypeHandler } from "./delete.js";
import { entityFieldsRouter } from "./fields/index.js";
import { exportEntitiesHandler } from "./export.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.post("/", ...createEntityTypeHandler);
router.get("/", ...listEntityTypesHandler);
router.get("/:id/export", ...exportEntitiesHandler);
router.get("/:id", ...getEntityTypeHandler);
router.patch("/:id", ...updateEntityTypeHandler);
router.delete("/:id", ...deleteEntityTypeHandler);
router.route("/:typeId/fields", entityFieldsRouter);

export { router as entityTypesRouter };
