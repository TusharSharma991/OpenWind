WITH
  et AS (
    INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
    VALUES (gen_random_uuid(), '{TENANT_ID}', 'Task', 'Tasks', '📋', '{MODULE_ID}', true)
    RETURNING id
  ),
  _fields AS (
    INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'title',        'Title',        'text',     true,  false, 0, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'description',  'Description',  'longtext', false, false, 1, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'priority',     'Priority',     'enum',     false, false, 2, '{"options":[{"value":"low","label":"Low","color":"#6b7280"},{"value":"medium","label":"Medium","color":"#f59e0b"},{"value":"high","label":"High","color":"#ef4444"}]}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'due_date',     'Due Date',     'date',     false, false, 3, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'assignee',     'Assignee',     'text',     false, false, 4, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'story_points', 'Story Points', 'number',   false, false, 5, '{}' FROM et
  ),
  wf AS (
    INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
    SELECT gen_random_uuid(), '{TENANT_ID}', et.id, 'Task Lifecycle', 'backlog' FROM et
    RETURNING id
  ),
  _states AS (
    INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
    SELECT gen_random_uuid(), wf.id, 'backlog',     'Backlog',     '#6b7280', false, 0 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'todo',        'To Do',       '#6366f1', false, 1 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'in_progress', 'In Progress', '#f59e0b', false, 2 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'in_review',   'In Review',   '#8b5cf6', false, 3 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'done',        'Done',        '#10b981', true,  4 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'cancelled',   'Cancelled',   '#ef4444', true,  5 FROM wf
  )
INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
SELECT gen_random_uuid(), wf.id, 'backlog',     'todo',        'Plan',           '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'todo',        'in_progress', 'Start',          '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'in_progress', 'in_review',   'Submit Review',  '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'in_review',   'done',        'Approve',        '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'in_review',   'in_progress', 'Request Changes','["admin","agent"]', true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'in_progress', 'done',        'Quick Done',     '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'todo',        'cancelled',   'Cancel',         '["admin","agent"]', true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'in_progress', 'todo',        'Block',          '["admin","agent"]', true,  '[]' FROM wf;
