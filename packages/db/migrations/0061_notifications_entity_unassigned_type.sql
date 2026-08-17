-- analytics: excluded (extends an existing excluded table's check constraint)
-- down:
--   ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
--     'entity.assigned', 'comment.mentioned', 'comment.mention_access_granted',
--     'comment.replied', 'access.granted', 'access.revoked', 'workflow.sla_breached',
--     'system.error', 'automation.notify', 'ticket.alert',
--     'access_request.created', 'access_request.updated', 'access.updated',
--     'workflow.transitioned', 'entity.updated', 'entity.due_date_approaching'
--   ));
--
-- Companion to 0060 (same bug class, missed on first pass): entity.unassigned was
-- already fully wired through notification-poller.ts/notification-recipients.ts/
-- notification-templates.ts, but never added to notifications_type_check. Caught
-- live 2026-08-17 while re-verifying 0060's own entity.assigned/entity.unassigned
-- automation-engine schema fix (event-schemas.ts's assigneeId/assignedBy/
-- previousAssigneeId/actorId fields wrongly required UUID shape, rejecting
-- AuthNexus's numeric-string user ids) — reassigning a ticket now reaches the
-- notifications INSERT successfully, which surfaced this second, previously
-- unreachable gap.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'entity.assigned',
  'entity.unassigned',
  'comment.mentioned',
  'comment.mention_access_granted',
  'comment.replied',
  'access.granted',
  'access.revoked',
  'workflow.sla_breached',
  'system.error',
  'automation.notify',
  'ticket.alert',
  'access_request.created',
  'access_request.updated',
  'access.updated',
  'workflow.transitioned',
  'entity.updated',
  'entity.due_date_approaching'
));
