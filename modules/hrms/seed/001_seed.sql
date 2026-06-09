WITH
  et AS (
    INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
    VALUES (gen_random_uuid(), '{TENANT_ID}', 'Leave Request', 'Leave Requests', '🏖️', '{MODULE_ID}', true)
    RETURNING id
  ),
  _fields AS (
    INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'employee_name', 'Employee Name', 'text',     true,  false, 0, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'leave_type',   'Leave Type',    'enum',     true,  false, 1, '{"options":[{"value":"annual","label":"Annual Leave"},{"value":"sick","label":"Sick Leave"},{"value":"unpaid","label":"Unpaid Leave"},{"value":"maternity","label":"Maternity/Paternity"}]}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'start_date',   'Start Date',    'date',     true,  false, 2, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'end_date',     'End Date',      'date',     true,  false, 3, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'days',         'Number of Days','number',   false, false, 4, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'reason',       'Reason',        'longtext', false, false, 5, '{}' FROM et
  ),
  wf AS (
    INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
    SELECT gen_random_uuid(), '{TENANT_ID}', et.id, 'Leave Approval', 'submitted' FROM et
    RETURNING id
  ),
  _states AS (
    INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
    SELECT gen_random_uuid(), wf.id, 'submitted',    'Submitted',   '#6366f1', false, 0 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'under_review', 'Under Review','#f59e0b', false, 1 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'approved',     'Approved',    '#10b981', true,  2 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'rejected',     'Rejected',    '#ef4444', true,  3 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'cancelled',    'Cancelled',   '#6b7280', true,  4 FROM wf
  )
INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
SELECT gen_random_uuid(), wf.id, 'submitted',    'under_review', 'Start Review', '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'under_review', 'approved',     'Approve',      '["admin"]',         false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'under_review', 'rejected',     'Reject',       '["admin"]',         true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'submitted',    'cancelled',    'Cancel',       '["admin","user"]',  false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'under_review', 'cancelled',    'Cancel',       '["admin","user"]',  true,  '[]' FROM wf;
