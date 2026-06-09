WITH
  et AS (
    INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
    VALUES (gen_random_uuid(), '{TENANT_ID}', 'Deal', 'Deals', '💼', '{MODULE_ID}', true)
    RETURNING id
  ),
  _fields AS (
    INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, is_indexed, sort_order, config)
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'company',       'Company',       'text',     true,  false, 0, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'contact_name',  'Contact Name',  'text',     true,  false, 1, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'contact_email', 'Contact Email', 'text',     false, false, 2, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'value',         'Deal Value',    'currency', false, false, 3, '{}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'source',        'Lead Source',   'enum',     false, false, 4, '{"options":[{"value":"inbound","label":"Inbound"},{"value":"outbound","label":"Outbound"},{"value":"referral","label":"Referral"},{"value":"partner","label":"Partner"}]}' FROM et UNION ALL
    SELECT gen_random_uuid(), et.id, '{TENANT_ID}', 'notes',         'Notes',         'longtext', false, false, 5, '{}' FROM et
  ),
  wf AS (
    INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
    SELECT gen_random_uuid(), '{TENANT_ID}', et.id, 'Sales Pipeline', 'lead' FROM et
    RETURNING id
  ),
  _states AS (
    INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
    SELECT gen_random_uuid(), wf.id, 'lead',        'Lead',        '#6366f1', false, 0 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'qualified',   'Qualified',   '#3b82f6', false, 1 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'proposal',    'Proposal',    '#f59e0b', false, 2 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'negotiation', 'Negotiation', '#8b5cf6', false, 3 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'won',         'Won',         '#10b981', true,  4 FROM wf UNION ALL
    SELECT gen_random_uuid(), wf.id, 'lost',        'Lost',        '#ef4444', true,  5 FROM wf
  )
INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
SELECT gen_random_uuid(), wf.id, 'lead',        'qualified',   'Qualify',          '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'qualified',   'proposal',    'Send Proposal',    '["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'proposal',    'negotiation', 'Start Negotiation','["admin","agent"]', false, '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'negotiation', 'won',         'Close Won',        '["admin","agent"]', true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'negotiation', 'lost',        'Close Lost',       '["admin","agent"]', true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'proposal',    'lost',        'Reject Proposal',  '["admin","agent"]', true,  '[]' FROM wf UNION ALL
SELECT gen_random_uuid(), wf.id, 'qualified',   'lost',        'Disqualify',       '["admin","agent"]', true,  '[]' FROM wf;
