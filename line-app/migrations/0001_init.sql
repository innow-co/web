-- Innow LINE MINI App: workshops, 4-digit codes, members, enrollments, content, audit

CREATE TABLE workshops (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  event_date   TEXT NOT NULL DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX codes_lookup ON codes(code, revoked, expires_at);
CREATE INDEX codes_workshop ON codes(workshop_id, created_at);

CREATE TABLE members (
  line_user_id      TEXT PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             TEXT NOT NULL,
  email_verified    INTEGER NOT NULL DEFAULT 0,
  display_name      TEXT NOT NULL DEFAULT '',
  picture_url       TEXT NOT NULL DEFAULT '',
  terms_accepted_at INTEGER NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  is_friend         INTEGER NOT NULL DEFAULT 0,
  last_seen_at      INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE TABLE enrollments (
  line_user_id TEXT NOT NULL REFERENCES members(line_user_id) ON DELETE CASCADE,
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  code_id      INTEGER,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (line_user_id, workshop_id)
);
CREATE INDEX enrollments_workshop ON enrollments(workshop_id);

-- kind: slide | prompt | bonus
CREATE TABLE items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_id  TEXT NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('slide','prompt','bonus')),
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  r2_key       TEXT NOT NULL DEFAULT '',
  file_name    TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX items_workshop ON items(workshop_id, kind, sort);

-- Code-entry attempts for server-side rate limiting
CREATE TABLE attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject    TEXT NOT NULL,
  ok         INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attempts_subject ON attempts(subject, created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_created ON audit_log(created_at);
