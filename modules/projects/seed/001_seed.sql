-- Projects module seed: Task tracking workflow
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Task', 'Tasks', '📋', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Task' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'title',       'Title',       'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'description', 'Description', 'longtext', false, 1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'priority',    'Priority',    'enum',     false, 2,
      '{"options":[{"value":"low","label":"Low","color":"#6b7280"},{"value":"medium","label":"Medium","color":"#f59e0b"},{"value":"high","label":"High","color":"#ef4444"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'due_date',    'Due Date',    'date',     false, 3, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'assignee',    'Assignee',    'text',     false, 4, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'story_points','Story Points','number',   false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Task Lifecycle', 'backlog')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'backlog',     'Backlog',     '#6b7280', false, 0),
    (gen_random_uuid(), wf_id, 'todo',        'To Do',       '#6366f1', false, 1),
    (gen_random_uuid(), wf_id, 'in_progress', 'In Progress', '#f59e0b', false, 2),
    (gen_random_uuid(), wf_id, 'in_review',   'In Review',   '#8b5cf6', false, 3),
    (gen_random_uuid(), wf_id, 'done',        'Done',        '#10b981', true,  4),
    (gen_random_uuid(), wf_id, 'cancelled',   'Cancelled',   '#ef4444', true,  5)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'backlog',     'todo',        'Plan',         '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'todo',        'in_progress', 'Start',        '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'in_progress', 'in_review',   'Submit Review','["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'in_review',   'done',        'Approve',      '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'in_review',   'in_progress', 'Request Changes','["admin","agent"]',true, '[]'),
    (gen_random_uuid(), wf_id, 'in_progress', 'done',        'Quick Done',   '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'todo',        'cancelled',   'Cancel',       '["admin","agent"]', true,  '[]'),
    (gen_random_uuid(), wf_id, 'in_progress', 'todo',        'Block',        '["admin","agent"]', true,  '[]')
  ON CONFLICT DO NOTHING;
END $$;
