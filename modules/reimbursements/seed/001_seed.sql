WITH
  et AS (
    INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
    VALUES (gen_random_uuid(), '{TENANT_ID}', 'Expense Claim', 'Expense Claims', '💸', '{MODULE_ID}', true)
    RETURNING id
  ),
  _fields AS (
    INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'title',        'Title',        'text',     true,  false, 0, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'amount',       'Amount',       'currency', true,  false, 1, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'category',     'Category',     'enum',     true,  false, 2, '{"options":[{"value":"travel","label":"Travel"},{"value":"meals","label":"Meals"},{"value":"accommodation","label":"Accommodation"},{"value":"equipment","label":"Equipment"},{"value":"other","label":"Other"}]}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'expense_date', 'Expense Date', 'date',     true,  false, 3, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'description',  'Description',  'longtext', false, false, 4, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'receipt',      'Receipt Note', 'text',     false, false, 5, '{}' FROM et
  ),
  wf AS (
    INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
    SELECT gen_random_uuid(), '{TENANT_ID}', et.id, 'Expense Approval', 'draft' FROM et
    RETURNING id
  ),
  _states AS (
    INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
    SELECT gen_random_uuid(), wf.id, 'draft',     'Draft',     '#6b7280', false, 0 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'submitted', 'Submitted', '#6366f1', false, 1 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'approved',  'Approved',  '#10b981', false, 2 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'paid',      'Paid',      '#3b82f6', true,  3 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'rejected',  'Rejected',  '#ef4444', true,  4 FROM wf
  )
INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
SELECT gen_random_uuid(), wf.id, 'draft',     'submitted', 'Submit',       '["admin","agent","user"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'submitted', 'approved',  'Approve',      '["admin"]',                false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'submitted', 'rejected',  'Reject',       '["admin"]',                true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'approved',  'paid',      'Mark Paid',    '["admin"]',                false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'submitted', 'draft',     'Return Draft', '["admin","user"]',         true,  '[]' FROM wf;
