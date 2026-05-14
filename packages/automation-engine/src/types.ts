export type TriggerType =
  | 'workflow.entered_state'
  | 'workflow.transitioned'
  | 'workflow.sla_breached'
  | 'field.changed'
  | 'entity.created'
  | 'entity.assigned'
  | 'schedule.cron'
  | 'connector.event';

export type ActionType =
  | 'notify'
  | 'assign'
  | 'transition'
  | 'set_field'
  | 'create_entity'
  | 'webhook'
  | 'connector.action'
  | 'script';
