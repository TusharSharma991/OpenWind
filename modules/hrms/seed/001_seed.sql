-- HRMS module seed: Leave Request workflow
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Leave Request', 'Leave Requests', '🏖️', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Leave Request' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'employee_name', 'Employee Name', 'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'leave_type',   'Leave Type',    'enum',     true,  1,
      '{"options":[{"value":"annual","label":"Annual Leave"},{"value":"sick","label":"Sick Leave"},{"value":"unpaid","label":"Unpaid Leave"},{"value":"maternity","label":"Maternity/Paternity"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'start_date',   'Start Date',    'date',     true,  2, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'end_date',     'End Date',      'date',     true,  3, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'days',         'Number of Days','number',   false, 4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'reason',       'Reason',        'longtext', false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Leave Approval', 'submitted')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'submitted',   'Submitted',     '#6366f1', false, 0),
    (gen_random_uuid(), wf_id, 'under_review','Under Review',  '#f59e0b', false, 1),
    (gen_random_uuid(), wf_id, 'approved',    'Approved',      '#10b981', true,  2),
    (gen_random_uuid(), wf_id, 'rejected',    'Rejected',      '#ef4444', true,  3),
    (gen_random_uuid(), wf_id, 'cancelled',   'Cancelled',     '#6b7280', true,  4)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'submitted',    'under_review', 'Start Review',  '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'under_review', 'approved',     'Approve',       '["admin"]',         false, '[]'),
    (gen_random_uuid(), wf_id, 'under_review', 'rejected',     'Reject',        '["admin"]',         true,  '[]'),
    (gen_random_uuid(), wf_id, 'submitted',    'cancelled',    'Cancel',        '["admin","user"]',  false, '[]'),
    (gen_random_uuid(), wf_id, 'under_review', 'cancelled',    'Cancel',        '["admin","user"]',  true,  '[]')
  ON CONFLICT DO NOTHING;
END $$;
