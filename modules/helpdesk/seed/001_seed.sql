DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Support Ticket', 'Support Tickets', '🎫', '{MODULE_ID}', true)
  RETURNING id INTO et_id;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'subject',        'Subject',        'text',     true,  true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'description',    'Description',    'longtext', false, false, 1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'priority',       'Priority',       'enum',     true,  false, 2,
      '{"options":[{"value":"low","label":"Low","color":"#6b7280"},{"value":"medium","label":"Medium","color":"#f59e0b"},{"value":"high","label":"High","color":"#ef4444"},{"value":"urgent","label":"Urgent","color":"#dc2626"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'category',       'Category',       'enum',     false, false, 3,
      '{"options":[{"value":"billing","label":"Billing"},{"value":"technical","label":"Technical"},{"value":"general","label":"General"},{"value":"feature_request","label":"Feature Request"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'customer_name',  'Customer Name',  'text',     true,  false, 4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'customer_email', 'Customer Email', 'text',     false, false, 5, '{}');

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Support Ticket Lifecycle', 'new')
  RETURNING id INTO wf_id;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'new',                  'New',                  '#6366f1', false, 0),
    (gen_random_uuid(), wf_id, 'open',                 'Open',                 '#3b82f6', false, 1),
    (gen_random_uuid(), wf_id, 'in_progress',          'In Progress',          '#f59e0b', false, 2),
    (gen_random_uuid(), wf_id, 'waiting_for_customer', 'Waiting for Customer', '#8b5cf6', false, 3),
    (gen_random_uuid(), wf_id, 'resolved',             'Resolved',             '#10b981', false, 4),
    (gen_random_uuid(), wf_id, 'closed',               'Closed',               '#6b7280', true,  5);

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'new',                  'open',                 'Assign',         '["admin","agent"]',        false, '[]'),
    (gen_random_uuid(), wf_id, 'open',                 'in_progress',          'Start Working',  '["admin","agent"]',        false, '[]'),
    (gen_random_uuid(), wf_id, 'in_progress',          'waiting_for_customer', 'Need More Info', '["admin","agent"]',        true,  '[]'),
    (gen_random_uuid(), wf_id, 'waiting_for_customer', 'in_progress',          'Responded',      '["admin","agent","user"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'in_progress',          'resolved',             'Mark Resolved',  '["admin","agent"]',        true,  '[]'),
    (gen_random_uuid(), wf_id, 'resolved',             'closed',               'Close Ticket',   '["admin","agent","user"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'resolved',             'in_progress',          'Reopen',         '["admin","agent","user"]', true,  '[]'),
    (gen_random_uuid(), wf_id, 'open',                 'resolved',             'Quick Resolve',  '["admin","agent"]',        true,  '[]');
END $$;
