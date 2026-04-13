CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- Google sub (stable user ID)
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'pending',  -- pending | editor | admin | denied
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
