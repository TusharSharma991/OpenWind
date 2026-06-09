-- CRM module seed: Lead / Deal pipeline
DO $$
DECLARE
  et_id UUID;
  wf_id UUID;
BEGIN
  INSERT INTO entity_types (id, tenant_id, name, plural, icon, module_id, allow_custom_fields)
  VALUES (gen_random_uuid(), '{TENANT_ID}', 'Deal', 'Deals', '💼', '{MODULE_ID}', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO et_id FROM entity_types
  WHERE tenant_id = '{TENANT_ID}' AND module_id = '{MODULE_ID}' AND name = 'Deal' LIMIT 1;
  IF et_id IS NULL THEN RETURN; END IF;

  INSERT INTO entity_fields (id, entity_type_id, tenant_id, name, label, field_type, is_required, sort_order, config)
  VALUES
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'company',      'Company',       'text',     true,  0, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'contact_name', 'Contact Name',  'text',     true,  1, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'contact_email','Contact Email', 'text',     false, 2, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'value',        'Deal Value',    'currency', false, 3, '{}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'source',       'Lead Source',   'enum',     false, 4,
      '{"options":[{"value":"inbound","label":"Inbound"},{"value":"outbound","label":"Outbound"},{"value":"referral","label":"Referral"},{"value":"partner","label":"Partner"}]}'),
    (gen_random_uuid(), et_id, '{TENANT_ID}', 'notes',        'Notes',         'longtext', false, 5, '{}')
  ON CONFLICT DO NOTHING;

  INSERT INTO workflows (id, tenant_id, entity_type_id, name, initial_state)
  VALUES (gen_random_uuid(), '{TENANT_ID}', et_id, 'Sales Pipeline', 'lead')
  RETURNING id INTO wf_id;
  IF wf_id IS NULL THEN RETURN; END IF;

  INSERT INTO workflow_states (id, workflow_id, name, label, color, is_terminal, sort_order)
  VALUES
    (gen_random_uuid(), wf_id, 'lead',        'Lead',        '#6366f1', false, 0),
    (gen_random_uuid(), wf_id, 'qualified',   'Qualified',   '#3b82f6', false, 1),
    (gen_random_uuid(), wf_id, 'proposal',    'Proposal',    '#f59e0b', false, 2),
    (gen_random_uuid(), wf_id, 'negotiation', 'Negotiation', '#8b5cf6', false, 3),
    (gen_random_uuid(), wf_id, 'won',         'Won',         '#10b981', true,  4),
    (gen_random_uuid(), wf_id, 'lost',        'Lost',        '#ef4444', true,  5)
  ON CONFLICT DO NOTHING;

  INSERT INTO workflow_transitions (id, workflow_id, from_state, to_state, label, allowed_roles, requires_comment, requires_fields)
  VALUES
    (gen_random_uuid(), wf_id, 'lead',        'qualified',   'Qualify',        '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'qualified',   'proposal',    'Send Proposal',  '["admin","agent"]', false, '[]'),
    (gen_random_uuid(), wf_id, 'proposal',    'negotiation', 'Start Negotiation','["admin","agent"]',false,'[]'),
    (gen_random_uuid(), wf_id, 'negotiation', 'won',         'Close Won',      '["admin","agent"]', true,  '[]'),
    (gen_random_uuid(), wf_id, 'negotiation', 'lost',        'Close Lost',     '["admin","agent"]', true,  '[]'),
    (gen_random_uuid(), wf_id, 'proposal',    'lost',        'Reject Proposal','["admin","agent"]', true,  '[]'),
    (gen_random_uuid(), wf_id, 'qualified',   'lost',        'Disqualify',     '["admin","agent"]', true,  '[]')
  ON CONFLICT DO NOTHING;
END $$;
