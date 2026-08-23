-- Visit log for alnimeri.com.
-- Apply once, in the D1 console or via:
--   npx wrangler d1 execute alnimeri_visits --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS visits (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,          -- ISO 8601, UTC
  ip       TEXT,
  country  TEXT,
  region   TEXT,
  city     TEXT,
  asn      TEXT,                   -- network operator, usually more telling than the IP
  path     TEXT,
  referrer TEXT,
  ua       TEXT,
  is_bot   INTEGER DEFAULT 0       -- crawlers flagged so they can be filtered out
);

CREATE INDEX IF NOT EXISTS idx_visits_ts     ON visits(ts DESC);
CREATE INDEX IF NOT EXISTS idx_visits_is_bot ON visits(is_bot);
