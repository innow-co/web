-- Quote requests ("ขอใบเสนอราคาอบรม") submitted from the contact menu; a copy is kept even when forwarding fails.
CREATE TABLE inquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id  TEXT NOT NULL,
  organization  TEXT NOT NULL,
  email         TEXT NOT NULL,
  course        TEXT NOT NULL,
  expectation   TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '',
  learners      INTEGER NOT NULL,
  forwarded     INTEGER NOT NULL DEFAULT 0,
  forward_error TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX inquiries_created ON inquiries(created_at);
