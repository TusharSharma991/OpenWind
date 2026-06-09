-- Procurement module seed: Purchase Order workflow
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Purchase Order', 'Purchase Orders', '🛒', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Purchase Order' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'title',        'Title',          'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'vendor',       'Vendor',         'text',     true,  1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'amount',       'Total Amount',   'currency', true,  2, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'category',     'Category',       'enum',     false, 3,
      '{"options":[{"value":"software","label":"Software"},{"value":"hardware","label":"Hardware"},{"value":"services","label":"Services"},{"value":"office","label":"Office Supplies"},{"value":"other","label":"Other"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'justification','Justification',  'longtext', true,  4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'required_date','Required By',    'date',     false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Purchase Approval', 'requested')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'requested',  'Requested',   '#6366f1', false, 0),
    (gen_random_uuid(), wf_id, 'under_review','Under Review','#f59e0b', false, 1),
    (gen_random_uuid(), wf_id, 'approved',   'Approved',    '#10b981', false, 2),
    (gen_random_uuid(), wf_id, 'ordered',    'Ordered',     '#3b82f6', false, 3),
    (gen_random_uuid(), wf_id, 'received',   'Received',    '#8b5cf6', true,  4),
    (gen_random_uuid(), wf_id, 'rejected',   'Rejected',    '#ef4444', true,  5)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'requested',   'under_review','Start Review',  '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'under_review', 'approved',   'Approve',       '["admin"]',         false, '[]'),
    (gen_random_uuid(), wf_id, 'under_review', 'rejected',   'Reject',        '["admin"]',         true,  '[]'),
    (gen_random_uuid(), wf_id, 'approved',     'ordered',    'Place Order',   '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'ordered',      'received',   'Mark Received', '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'approved',     'rejected',   'Cancel',        '["admin"]',         true,  '[]')
  ON CONFLICT DO NOTHING;
END $$;
