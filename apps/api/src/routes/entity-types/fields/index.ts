import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { createEntityFieldHandler } from "./create-field.js";
import { listEntityFieldsHandler } from "./list-fields.js";
import { updateEntityFieldHandler } from "./update-field.js";
import { deleteEntityFieldHandler } from "./delete-field.js";

// Hono child routers don't inherit parent route params — extract typeId from
// the URL path and store it in context so all field handlers can read it.
const router = new Hono<{ Variables: { auth: AuthContext; typeId: string } }>();

router.use("/*", async (c, next) => {
  // URL pattern: /entity-types/:typeId/fields/...
  const match = c.req.url.match(/entity-types\/([^/]+)\/fields/);
  c.set("typeId", match?.[1] ?? "");
  await next();
});

router.post("/", ...createEntityFieldHandler);
router.get("/", ...listEntityFieldsHandler);
router.patch("/:fieldId", ...updateEntityFieldHandler);
router.delete("/:fieldId", ...deleteEntityFieldHandler);

export { router as entityFieldsRouter };
