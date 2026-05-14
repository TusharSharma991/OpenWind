import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const automationRules = pgTable('automation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  triggerType: text('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').notNull(),
  conditions: jsonb('conditions'),
  actions: jsonb('actions').notNull(),
  priority: integer('priority').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const automationExecutions = pgTable(
  'automation_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ruleId: uuid('rule_id').notNull().references(() => automationRules.id),
    triggerEvent: jsonb('trigger_event').notNull(),
    status: text('status').notNull(),
    result: jsonb('result'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantRuleIdx: index('automation_executions_tenant_rule_idx').on(t.tenantId, t.ruleId, t.status),
  })
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    eventType: text('event_type').notNull(),
    version: integer('version').default(1).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => ({
    undeliveredIdx: index('outbox_events_undelivered_idx').on(t.deliveredAt, t.createdAt),
  })
);
