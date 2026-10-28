-- Arth household relay (Cloudflare D1). Holds only encrypted envelopes and random IDs.
-- No names, amounts or IP addresses are ever stored here.

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  -- the token before the last rekey: may still read the log for a while (see oldTokenGraceMs)
  old_token_hash TEXT,
  old_token_until INTEGER,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS log (
  hh TEXT NOT NULL,
  member TEXT NOT NULL,
  seq INTEGER NOT NULL,
  blob TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (hh, member, seq)
);
CREATE INDEX IF NOT EXISTS log_created ON log (created_at);

CREATE TABLE IF NOT EXISTS cursors (
  hh TEXT NOT NULL,
  member TEXT NOT NULL,
  acked_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (hh, member)
);

-- Highest seq each member has written (kept after pruning; see GET /log "heads").
CREATE TABLE IF NOT EXISTS heads (
  hh TEXT NOT NULL,
  member TEXT NOT NULL,
  max_seq INTEGER NOT NULL,
  PRIMARY KEY (hh, member)
);

CREATE TABLE IF NOT EXISTS quota (
  hh TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (hh, day)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY NOT NULL,
  hh TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  request_blob TEXT,
  accept_blob TEXT
);
CREATE INDEX IF NOT EXISTS invites_hh ON invites (hh);
