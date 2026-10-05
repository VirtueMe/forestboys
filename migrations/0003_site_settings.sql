-- #75: site-wide settings an admin can change without a deploy. One row per key;
-- a missing key means the built-in default (functions/_lib/site-settings.ts).
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
