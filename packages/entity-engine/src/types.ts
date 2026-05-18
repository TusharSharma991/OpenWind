import type { FieldType } from "./field-types.js";
import type { FieldError } from "./errors.js";

export interface EntityType {
  id: string;
  tenantId: string | null;
  name: string;
  plural: string;
  icon: string | null;
  moduleId: string | null;
  allowCustomFields: boolean;
  createdAt: Date;
}

export interface EntityField {
  id: string;
  entityTypeId: string;
  tenantId: string | null;
  name: string;
  label: string;
  fieldType: FieldType;
  config: Record<string, unknown>;
  isRequired: boolean;
  isIndexed: boolean;
  isSystem: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface EntityInstance {
  id: string;
  entityTypeId: string;
  tenantId: string;
  workflowId: string | null;
  currentState: string;
  fields: Record<string, unknown>;
  createdBy: string | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface EntityRelation {
  id: string;
  tenantId: string;
  fromInstanceId: string;
  toInstanceId: string;
  relationType: string;
  createdAt: Date;
}

export type CreateEntityInput = {
  entityTypeId: string;
  fields: Record<string, unknown>;
  createdBy?: string | undefined;
  assignedTo?: string | undefined;
  workflowId?: string | undefined;
};

export type UpdateEntityInput = {
  fields?: Record<string, unknown> | undefined;
  assignedTo?: string | null | undefined;
};

export type ListEntitiesInput = {
  entityTypeId: string;
  state?: string | undefined;
  assignedTo?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  includeDeleted?: boolean | undefined;
};

export type SearchEntitiesInput = {
  entityTypeId: string;
  query: string;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export const BULK_MAX_ITEMS = 100;

export type BulkCreateResult = {
  created: EntityInstance[];
  errors: Array<{ index: number; fields: FieldError[] }>;
};

export type BulkUpdateResult = {
  updated: EntityInstance[];
  errors: Array<{
    index: number;
    id: string;
    code: string;
    fields?: FieldError[];
  }>;
};

export type BulkSetStateResult = {
  updatedIds: string[];
  errors: Array<{ index: number; id: string; code: string }>;
};
