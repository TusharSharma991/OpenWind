-- Reimbursements module seed: Expense claim workflow
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Expense Claim', 'Expense Claims', '💸', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Expense Claim' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'title',        'Title',         'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'amount',       'Amount',        'currency', true,  1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'category',     'Category',      'enum',     true,  2,
      '{"options":[{"value":"travel","label":"Travel"},{"value":"meals","label":"Meals"},{"value":"accommodation","label":"Accommodation"},{"value":"equipment","label":"Equipment"},{"value":"other","label":"Other"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'expense_date', 'Expense Date',  'date',     true,  3, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'description',  'Description',   'longtext', false, 4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'receipt',      'Receipt Note',  'text',     false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Expense Approval', 'draft')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'draft',     'Draft',       '#6b7280', false, 0),
    (gen_random_uuid(), wf_id, 'submitted', 'Submitted',   '#6366f1', false, 1),
    (gen_random_uuid(), wf_id, 'approved',  'Approved',    '#10b981', false, 2),
    (gen_random_uuid(), wf_id, 'paid',      'Paid',        '#3b82f6', true,  3),
    (gen_random_uuid(), wf_id, 'rejected',  'Rejected',    '#ef4444', true,  4)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'draft',     'submitted', 'Submit',      '["admin","agent","user"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'submitted', 'approved',  'Approve',     '["admin"]',                false, '[]'),
    (gen_random_uuid(), wf_id, 'submitted', 'rejected',  'Reject',      '["admin"]',                true,  '[]'),
    (gen_random_uuid(), wf_id, 'approved',  'paid',      'Mark Paid',   '["admin"]',                false, '[]'),
    (gen_random_uuid(), wf_id, 'submitted', 'draft',     'Return Draft','["admin","user"]',          true,  '[]')
  ON CONFLICT DO NOTHING;
END $$;
