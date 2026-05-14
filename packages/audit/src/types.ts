export interface AuditEvent {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  meta?: Record<string, unknown>;
  occurredAt: Date;
}
