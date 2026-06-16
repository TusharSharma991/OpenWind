import { z } from "zod";

export const CreateSavedViewSchema = z.object({
  entityTypeId: z.string().uuid(),
  name: z.string().min(1).max(60),
  filterConfig: z.record(z.unknown()).optional().default({}),
  sortConfig: z.record(z.unknown()).optional().default({}),
  isDefault: z.boolean().optional().default(false),
});

export const UpdateSavedViewSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  filterConfig: z.record(z.unknown()).optional(),
  sortConfig: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

export const ListSavedViewsQuerySchema = z.object({
  entityTypeId: z.string().uuid(),
});
