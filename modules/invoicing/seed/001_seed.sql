-- Invoicing module seed: Invoice workflow
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Invoice', 'Invoices', '🧾', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Invoice' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'invoice_number','Invoice #',      'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'client_name',  'Client Name',    'text',     true,  1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'client_email', 'Client Email',   'text',     false, 2, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'amount',       'Amount',         'currency', true,  3, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'due_date',     'Due Date',       'date',     true,  4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'description',  'Description',    'longtext', false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Invoice Lifecycle', 'draft')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'draft',    'Draft',    '#6b7280', false, 0),
    (gen_random_uuid(), wf_id, 'sent',     'Sent',     '#3b82f6', false, 1),
    (gen_random_uuid(), wf_id, 'viewed',   'Viewed',   '#8b5cf6', false, 2),
    (gen_random_uuid(), wf_id, 'paid',     'Paid',     '#10b981', true,  3),
    (gen_random_uuid(), wf_id, 'overdue',  'Overdue',  '#ef4444', false, 4),
    (gen_random_uuid(), wf_id, 'cancelled','Cancelled','#6b7280', true,  5)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'draft',   'sent',      'Send Invoice',   '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'sent',    'viewed',    'Mark Viewed',    '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'sent',    'paid',      'Record Payment', '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'viewed',  'paid',      'Record Payment', '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'sent',    'overdue',   'Mark Overdue',   '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'viewed',  'overdue',   'Mark Overdue',   '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'overdue', 'paid',      'Record Payment', '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'draft',   'cancelled', 'Cancel',         '["admin","agent"]', false, '[]')
  ON CONFLICT DO NOTHING;
END $$;
