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
}

export interface EntityField {
  id: string;
  entityTypeId: string;
  tenantId: string | null;
  name: string;
  label: string;
  fieldType: string;
  config: Record<string, unknown>;
  isRequired: boolean;
  isIndexed: boolean;
  isSystem: boolean;
  sortOrder: number;
}
