"""media.db: what the store holds, and what names it. Times are epoch milliseconds."""


def link_triggers(table: str) -> str:
    """A link clears its blob's unnamed_since; the last link of a hash to go sets it, cascades included."""
    return f"""
CREATE TRIGGER {table}_named AFTER INSERT ON {table} BEGIN
  UPDATE blobs SET unnamed_since = NULL WHERE hash = NEW.hash;
END;
CREATE TRIGGER {table}_unnamed AFTER DELETE ON {table}
WHEN NOT EXISTS (SELECT 1 FROM entry_blobs WHERE hash = OLD.hash)
 AND NOT EXISTS (SELECT 1 FROM record_blobs WHERE hash = OLD.hash)
 AND NOT EXISTS (SELECT 1 FROM job_blobs WHERE hash = OLD.hash)
BEGIN
  UPDATE blobs SET unnamed_since = strftime('%s', 'now') * 1000 WHERE hash = OLD.hash;
END;
"""


SCHEMA_V1 = (
    """
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  touched_at INTEGER NOT NULL,
  unnamed_since INTEGER,
  transient INTEGER NOT NULL DEFAULT 0,
  lost_at INTEGER
);
CREATE INDEX blobs_unnamed ON blobs(unnamed_since) WHERE unnamed_since IS NOT NULL;
CREATE INDEX blobs_lost ON blobs(lost_at) WHERE lost_at IS NOT NULL;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  user TEXT,
  saved_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  trashed_at INTEGER,
  trashed_by TEXT,
  trashed_cause TEXT,
  frames INTEGER NOT NULL,
  pictures INTEGER NOT NULL,
  role TEXT,
  control TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  schema INTEGER NOT NULL,
  document TEXT NOT NULL
);
CREATE INDEX entries_trashed ON entries(trashed_at);
CREATE INDEX entries_pinned ON entries(pinned, used_at);

CREATE TABLE records (
  job_id TEXT PRIMARY KEY,
  client TEXT NOT NULL,
  user TEXT,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  routed INTEGER NOT NULL DEFAULT 0,
  document TEXT NOT NULL
);
CREATE INDEX records_created ON records(created_at);
CREATE INDEX records_client ON records(client, routed);

CREATE TABLE entry_blobs (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
  PRIMARY KEY (entry_id, hash)
);
CREATE INDEX entry_blobs_hash ON entry_blobs(hash);

CREATE TABLE record_blobs (
  job_id TEXT NOT NULL REFERENCES records(job_id) ON DELETE CASCADE,
  hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
  PRIMARY KEY (job_id, hash)
);
CREATE INDEX record_blobs_hash ON record_blobs(hash);

-- the refs and made maps of a pending or running job
CREATE TABLE job_blobs (
  job_id TEXT NOT NULL,
  hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE RESTRICT,
  named_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, hash)
);
CREATE INDEX job_blobs_hash ON job_blobs(hash);

-- the 16-hex ids of uploads taken in from the folder earlier builds staged them in
CREATE TABLE legacy_uploads (id TEXT PRIMARY KEY, hash TEXT NOT NULL);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE VIEW names AS SELECT hash FROM entry_blobs UNION SELECT hash FROM record_blobs UNION SELECT hash FROM job_blobs;
"""
    + link_triggers("entry_blobs")
    + link_triggers("record_blobs")
    + link_triggers("job_blobs")
)

MIGRATIONS = [(1, SCHEMA_V1)]
