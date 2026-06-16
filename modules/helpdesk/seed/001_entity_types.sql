-- modules/helpdesk/seed/001_entity_types.sql

-- Insert entity types idempotently
INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
SELECT gen_random_uuid(), '{TENANT_ID}', 'ticket', 'Tickets', 'ticket', '{MODULE_ID}', true
WHERE NOT EXISTS (
  SELECT 1 FROM entity_types WHERE name = 'ticket' AND tenant_id = '{TENANT_ID}'
);

INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
SELECT gen_random_uuid(), '{TENANT_ID}', 'comment', 'Comments', 'comment', '{MODULE_ID}', true
WHERE NOT EXISTS (
  SELECT 1 FROM entity_types WHERE name = 'comment' AND tenant_id = '{TENANT_ID}'
);

INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
SELECT gen_random_uuid(), '{TENANT_ID}', 'article', 'Articles', 'article', '{MODULE_ID}', true
WHERE NOT EXISTS (
  SELECT 1 FROM entity_types WHERE name = 'article' AND tenant_id = '{TENANT_ID}'
);

-- Insert fields for Ticket
INSERT INTO entity_fields (entity_type_id, tenant_id, name, label, field_type, config, is_required, is_indexed, is_system, sort_order)
VALUES
  ((SELECT id FROM entity_types WHERE name = 'ticket' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'title', 'Title', 'text', '{}'::jsonb, true, true, true, 1),
  ((SELECT id FROM entity_types WHERE name = 'ticket' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'description', 'Description', 'textarea', '{}'::jsonb, false, false, true, 2),
  ((SELECT id FROM entity_types WHERE name = 'ticket' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'priority', 'Priority', 'select', '{"options": ["low", "medium", "high", "urgent"]}'::jsonb, true, true, true, 3),
  ((SELECT id FROM entity_types WHERE name = 'ticket' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'category', 'Category', 'select', '{"options": ["technical", "billing", "general"]}'::jsonb, true, true, true, 4)
ON CONFLICT (entity_type_id, name) DO NOTHING;

-- Insert fields for Comment
INSERT INTO entity_fields (entity_type_id, tenant_id, name, label, field_type, config, is_required, is_indexed, is_system, sort_order)
VALUES
  ((SELECT id FROM entity_types WHERE name = 'comment' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'body', 'Body', 'textarea', '{}'::jsonb, true, false, true, 1),
  ((SELECT id FROM entity_types WHERE name = 'comment' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'ticket_id', 'Ticket', 'entity_ref', '{"target_entity_type": "ticket"}'::jsonb, true, true, true, 2)
ON CONFLICT (entity_type_id, name) DO NOTHING;

-- Insert fields for Article
INSERT INTO entity_fields (entity_type_id, tenant_id, name, label, field_type, config, is_required, is_indexed, is_system, sort_order)
VALUES
  ((SELECT id FROM entity_types WHERE name = 'article' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'title', 'Title', 'text', '{}'::jsonb, true, true, true, 1),
  ((SELECT id FROM entity_types WHERE name = 'article' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'body', 'Body', 'textarea', '{}'::jsonb, true, false, true, 2),
  ((SELECT id FROM entity_types WHERE name = 'article' AND tenant_id = '{TENANT_ID}'), '{TENANT_ID}', 'category', 'Category', 'text', '{}'::jsonb, false, true, true, 3)
ON CONFLICT (entity_type_id, name) DO NOTHING;
