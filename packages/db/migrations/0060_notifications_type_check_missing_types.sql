-- analytics: excluded (extends an existing excluded table's check constraint)
-- down:
--   ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
--     'entity.assigned', 'comment.mentioned', 'comment.mention_access_granted',
--     'comment.replied', 'access.granted', 'access.revoked', 'workflow.sla_breached',
--     'system.error', 'automation.notify', 'ticket.alert'
--   ));
--
-- Fixes a real bug caught in local testing (2026-08-14): notification-poller.ts's
-- NOTIFICATION_EVENT_TYPES allowlist and notification-recipients.ts/
-- notification-templates.ts both already handled these 6 event types, but the
-- notifications table's own CHECK constraint was never extended to match —
-- every one of them silently failed the INSERT into `notifications` and landed
-- in dead_letter_events, even though the outbox event, recipient resolution,
-- and template all worked correctly. `access_request.created`/
-- `access_request.updated` came from the tushar-branch access-request feature
-- (never fully wired end-to-end); the other four are new from this session's
-- ui-feature-checklist-and-rules.md gap closures (2.3/2.4/2.5/2.8).
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'entity.assigned',
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
