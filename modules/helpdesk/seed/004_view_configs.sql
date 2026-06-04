-- modules/helpdesk/seed/004_view_configs.sql

-- Seeding view configs for Helpdesk entities

-- Ticket layout
INSERT INTO view_configs (id, tenant_id, entity_type_slug, list_columns, detail_layout, form_field_order)
VALUES (
  gen_random_uuid(),
  '{TENANT_ID}',
  'ticket',
  '[
    {"field": "title", "label": "Title", "width": 300, "sortable": true},
    {"field": "priority", "label": "Priority", "width": 120, "sortable": true},
    {"field": "category", "label": "Category", "width": 150, "sortable": true},
    {"field": "currentState", "label": "Status", "width": 120, "sortable": true},
    {"field": "createdAt", "label": "Created At", "width": 180, "sortable": true}
  ]'::jsonb,
  '[
    {"group": "Overview", "fields": ["title", "description"]},
    {"group": "Metadata", "fields": ["priority", "category", "currentState", "assignedTo"]}
  ]'::jsonb,
  '["title", "description", "priority", "category"]'::jsonb
)
ON CONFLICT (tenant_id, entity_type_slug) DO NOTHING;

-- Comment layout
INSERT INTO view_configs (id, tenant_id, entity_type_slug, list_columns, detail_layout, form_field_order)
VALUES (
  gen_random_uuid(),
  '{TENANT_ID}',
  'comment',
  '[]'::jsonb,
  '[]'::jsonb,
  '["body"]'::jsonb
)
ON CONFLICT (tenant_id, entity_type_slug) DO NOTHING;

-- Article layout
INSERT INTO view_configs (id, tenant_id, entity_type_slug, list_columns, detail_layout, form_field_order)
VALUES (
  gen_random_uuid(),
  '{TENANT_ID}',
  'article',
  '[
    {"field": "title", "label": "Title", "width": 400, "sortable": true},
    {"field": "category", "label": "Category", "width": 150, "sortable": true},
    {"field": "createdAt", "label": "Created At", "width": 180, "sortable": true}
  ]'::jsonb,
  '[
    {"group": "Article Info", "fields": ["title", "body", "category"]}
  ]'::jsonb,
  '["title", "body", "category"]'::jsonb
)
ON CONFLICT (tenant_id, entity_type_slug) DO NOTHING;
