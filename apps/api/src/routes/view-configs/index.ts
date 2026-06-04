import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "@platform/auth";
import { requireAuth, requireRole } from "@platform/auth";
import { db, viewConfigs } from "@platform/db";

type Vars = { Variables: { auth: AuthContext } };

const router = new Hono<Vars>();

router.use("*", requireAuth(db));

// GET /admin/view-configs/:entityType
router.get("/:entityType", async (c) => {
  const auth = c.get("auth");
  const entityType = c.req.param("entityType");

  try {
    const [row] = await db
      .select()
      .from(viewConfigs)
      .where(
        and(
          eq(viewConfigs.tenantId, auth.tenantId),
          eq(viewConfigs.entityTypeSlug, entityType),
        ),
      )
      .limit(1);

    if (!row) {
      return c.json(
        {
          error: "NOT_FOUND",
          message: `View config not found for: ${entityType}`,
        },
        404,
      );
    }

    return c.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: "INTERNAL_ERROR", message: msg }, 500);
  }
});

// PATCH /admin/view-configs/:entityType (Admin only)
router.patch("/:entityType", requireRole("admin"), async (c) => {
  const auth = c.get("auth");
  const entityType = c.req.param("entityType");

  try {
    const body = await c.req.json<{
      listColumns?: unknown[];
      detailLayout?: unknown[];
      formFieldOrder?: unknown[];
    }>();

    // Fetch existing row first to merge
    const [existing] = await db
      .select()
      .from(viewConfigs)
      .where(
        and(
          eq(viewConfigs.tenantId, auth.tenantId),
          eq(viewConfigs.entityTypeSlug, entityType),
        ),
      )
      .limit(1);

    const listColumns = (body.listColumns ??
      existing?.listColumns ??
      []) as string[];
    const detailLayout = (body.detailLayout ??
      existing?.detailLayout ??
      []) as string[];
    const formFieldOrder = (body.formFieldOrder ??
      existing?.formFieldOrder ??
      []) as string[];

    const [row] = await db
      .insert(viewConfigs)
      .values({
        tenantId: auth.tenantId,
        entityTypeSlug: entityType,
        listColumns,
        detailLayout,
        formFieldOrder,
      })
      .onConflictDoUpdate({
        target: [viewConfigs.tenantId, viewConfigs.entityTypeSlug],
        set: {
          listColumns,
          detailLayout,
          formFieldOrder,
          updatedAt: new Date(),
        },
      })
      .returning();

    return c.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: "INTERNAL_ERROR", message: msg }, 500);
  }
});

export { router as viewConfigsRouter };
