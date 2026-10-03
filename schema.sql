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

-- Briefs from the "Get in touch" form. functions/api/brief.js also creates
-- this table on first use, so applying it by hand is optional.
CREATE TABLE IF NOT EXISTS briefs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  name      TEXT NOT NULL,
  company   TEXT,
  about     TEXT,
  for_what  TEXT,
  timing    TEXT,
  email     TEXT,
  whatsapp  TEXT,
  film_seen TEXT,
  message   TEXT,
  ip        TEXT,
  country   TEXT,
  ua        TEXT
);

-- What visitors do, not who they are (functions/api/e.js, which also creates
-- this table on first use): Play pressed, the brief opened, sent or failed, a
-- view count followed to its post, a shortlist shared, the CV downloaded.
-- No IP, no user agent, no cookie or id. Kept ninety days.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,          -- ISO 8601, UTC
  t       TEXT NOT NULL,          -- play, brief_open, brief_sent, brief_failed, proof_click, shortlist_share, cv_pdf
  film    TEXT,                   -- a film page's slug, or several joined by commas
  path    TEXT,                   -- the page it happened on
  via     TEXT,                   -- how: lightbox, page, post; copy, share; or where a /brief link was shared
  country TEXT                    -- Cloudflare's two letters
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
