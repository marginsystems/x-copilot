-- Durable Scout evidence. Reply / skip / dismiss observations survive the
-- tank prune, the 200-row skip/dismiss caps, the 2,000-row interaction
-- retain, and approach-lock clears. Every read and write is scoped by
-- user_id; tenant_id is never a read key here.

CREATE TABLE IF NOT EXISTS scout_evidence (
  user_id TEXT NOT NULL,
  -- reply:<replyId> | skip:scout:<cardId> | dismiss:for-you:<suggestionId> ...
  event_key TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  target_id TEXT,
  card_id TEXT,
  conversation_id TEXT,
  parent_id TEXT,
  reply_id TEXT,
  acted_at TEXT NOT NULL,
  thread_kind TEXT,
  target_author TEXT,
  topics_json TEXT,
  context_source TEXT,
  note_state TEXT NOT NULL DEFAULT 'unknown',
  note_verified_at TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scout_evidence_user_reply
  ON scout_evidence (user_id, reply_id)
  WHERE action = 'take' AND reply_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scout_evidence_user_target
  ON scout_evidence (user_id, target_id);

CREATE INDEX IF NOT EXISTS idx_scout_evidence_user_acted_at
  ON scout_evidence (user_id, acted_at, event_key);

-- Per-user monotonic revision; advances only on material evidence changes.
CREATE TABLE IF NOT EXISTS scout_evidence_revisions (
  user_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  last_event_key TEXT
);

-- Server-owned target context retained at watch / approach-lock time so a
-- later webhook or reconciliation pass can still learn kind / author / topics
-- after the card left the tank or the lock was cleared.
CREATE TABLE IF NOT EXISTS scout_target_context (
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  card_id TEXT,
  conversation_id TEXT,
  in_reply_to_id TEXT,
  author TEXT,
  thread_kind TEXT,
  topics_json TEXT,
  context_source TEXT NOT NULL,
  retained_at TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_scout_target_context_conversation
  ON scout_target_context (user_id, conversation_id);

-- Resumable keyset cursors for the bounded evidence reconciliation pass.
CREATE TABLE IF NOT EXISTS scout_evidence_cursors (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope)
);
