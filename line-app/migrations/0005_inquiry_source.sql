-- Quote requests now also arrive from the marketing website (server-to-server). 'line' = sent from the LINE app
-- (existing rows), 'web' = recorded via POST /api/inquiry/web (line_user_id is '' for those).
ALTER TABLE inquiries ADD COLUMN source TEXT NOT NULL DEFAULT 'line';
