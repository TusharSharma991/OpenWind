WITH
  et AS (
    INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
    VALUES (gen_random_uuid(), '{TENANT_ID}', 'Purchase Order', 'Purchase Orders', '🛒', '{MODULE_ID}', true)
    RETURNING id
  ),
  _fields AS (
    INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'title',         'Title',         'text',     true,  false, 0, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'vendor',        'Vendor',        'text',     true,  false, 1, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'amount',        'Total Amount',  'currency', true,  false, 2, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'category',      'Category',      'enum',     false, false, 3, '{"options":[{"value":"software","label":"Software"},{"value":"hardware","label":"Hardware"},{"value":"services","label":"Services"},{"value":"office","label":"Office Supplies"},{"value":"other","label":"Other"}]}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'justification', 'Justification', 'longtext', true,  false, 4, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'required_date', 'Required By',   'date',     false, false, 5, '{}' FROM et
  ),
  wf AS (
    INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
    SELECT gen_random_uuid(), '{TENANT_ID}', et.id, 'Purchase Approval', 'requested' FROM et
    RETURNING id
  ),
  _states AS (
    INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
    SELECT gen_random_uuid(), wf.id, 'requested',   'Requested',    '#6366f1', false, 0 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'under_review', 'Under Review', '#f59e0b', false, 1 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'approved',    'Approved',     '#10b981', false, 2 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'ordered',     'Ordered',      '#3b82f6', false, 3 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'received',    'Received',     '#8b5cf6', true,  4 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'rejected',    'Rejected',     '#ef4444', true,  5 FROM wf
  )
INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
SELECT gen_random_uuid(), wf.id, 'requested',    'under_review', 'Start Review',  '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'under_review', 'approved',     'Approve',       '["admin"]',         false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'under_review', 'rejected',     'Reject',        '["admin"]',         true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'approved',     'ordered',      'Place Order',   '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'ordered',      'received',     'Mark Received', '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'approved',     'rejected',     'Cancel',        '["admin"]',         true,  '[]' FROM wf;
