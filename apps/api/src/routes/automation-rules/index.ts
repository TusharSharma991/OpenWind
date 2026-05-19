import { Hono } from "hono";
import type { AuthContext } from "@platform/auth";
import { createAutomationRuleHandler } from "./create.js";
import { listAutomationRulesHandler } from "./list.js";
import { getAutomationRuleHandler } from "./get.js";
import { updateAutomationRuleHandler } from "./update.js";
import { deleteAutomationRuleHandler } from "./delete.js";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.post("/", ...createAutomationRuleHandler);
router.get("/", ...listAutomationRulesHandler);
router.get("/:id", ...getAutomationRuleHandler);
router.patch("/:id", ...updateAutomationRuleHandler);
router.delete("/:id", ...deleteAutomationRuleHandler);

export { router as automationRulesRouter };
