-- AI automation consultations ("ปรึกษาการ Setup AI ทำ Automation") from the contact menu. No email is sent; the admin page is the review place.
-- Numbered 0004 on purpose: 0003 is reserved for another feature (migrations apply in filename order, a gap is fine).
CREATE TABLE consultations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT NOT NULL,
  organization  TEXT NOT NULL,
  email         TEXT NOT NULL,
  systems       TEXT NOT NULL,
  goals         TEXT NOT NULL,
  team_size     INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX consultations_created ON consultations(created_at);
