import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { listSavedViewsHandler } from "./list.js";
import { createSavedViewHandler } from "./create.js";
import { updateSavedViewHandler } from "./update.js";
import { deleteSavedViewHandler } from "./delete.js";

const savedViewsRouter = new Hono<{ Variables: { auth: AuthContext } }>();

savedViewsRouter.get("/", ...listSavedViewsHandler);
savedViewsRouter.post("/", ...createSavedViewHandler);
savedViewsRouter.patch("/:id", ...updateSavedViewHandler);
savedViewsRouter.delete("/:id", ...deleteSavedViewHandler);

export { savedViewsRouter };
