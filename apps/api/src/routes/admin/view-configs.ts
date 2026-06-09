/**
 * View config routes — per-tenant UI layout overrides for entity types.
 *
 * GET  /admin/view-configs/:entityType  — returns current config or module default
 * PATCH /admin/view-configs/:entityType — upsert (tenant-scoped)
 */
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, requireRole } from "@platform/auth";
import { db } from "@platform/db";
import { viewConfigs } from "@platform/db";
import { eq, and } from "drizzle-orm";
import { factory } from "./factory.js";

const ListColumnSchema = z.object({
  field: z.string().min(1),
  label: z.string().min(1),
  width: z.number().int().min(50).optional(),
  sortable: z.boolean().default(false),
});

const DetailGroupSchema = z.object({
  group: z.string().min(1),
  fields: z.array(z.string().min(1)),
});

const ViewConfigPatchSchema = z
  .object({
    listColumns: z.array(ListColumnSchema).optional(),
    detailLayout: z.array(DetailGroupSchema).optional(),
    formFieldOrder: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

export const getViewConfigHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin", "agent", "member"),
  async (c) => {
    const entityType = c.req.param("entityType") ?? "";
    const { tenantId } = c.get("auth");

    const [row] = await db
      .select()
      .from(viewConfigs)
      .where(
        and(
          eq(viewConfigs.tenantId, tenantId),
          eq(viewConfigs.entityTypeSlug, entityType),
        ),
      )
      .limit(1);

    if (!row) {
      return c.json({
        data: {
          entityTypeSlug: entityType,
          listColumns: [],
          detailLayout: [],
          formFieldOrder: [],
        },
      });
    }

    return c.json({ data: row });
  },
);

export const updateViewConfigHandler = factory.createHandlers(
  requireAuth(),
  requireRole("admin"),
  zValidator("json", ViewConfigPatchSchema),
  async (c) => {
    const entityType = c.req.param("entityType") ?? "";
    const { tenantId } = c.get("auth");
    const input = c.req.valid("json");
    const now = new Date();

    const [existing] = await db
      .select({ id: viewConfigs.id })
      .from(viewConfigs)
      .where(
        and(
          eq(viewConfigs.tenantId, tenantId),
          eq(viewConfigs.entityTypeSlug, entityType),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(viewConfigs)
        .set({
          ...(input.listColumns !== undefined && {
            listColumns: input.listColumns,
          }),
          ...(input.detailLayout !== undefined && {
            detailLayout: input.detailLayout,
          }),
          ...(input.formFieldOrder !== undefined && {
            formFieldOrder: input.formFieldOrder,
          }),
          updatedAt: now,
        })
        .where(eq(viewConfigs.id, existing.id))
        .returning();

      return c.json({ data: updated });
    }

    const [created] = await db
      .insert(viewConfigs)
      .values({
        tenantId,
        entityTypeSlug: entityType,
        listColumns: input.listColumns ?? [],
        detailLayout: input.detailLayout ?? [],
        formFieldOrder: input.formFieldOrder ?? [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return c.json({ data: created }, 201);
  },
);
