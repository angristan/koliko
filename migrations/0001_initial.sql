PRAGMA foreign_keys = ON;

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE telemetry_events (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  session_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  event_type TEXT NOT NULL,
  repository TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  thinking_level TEXT,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  total_tokens INTEGER,
  cost_total REAL,
  tool_name TEXT,
  status TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX telemetry_events_occurred_at_idx ON telemetry_events(occurred_at);
CREATE INDEX telemetry_events_session_idx ON telemetry_events(session_id, occurred_at);
CREATE INDEX telemetry_events_type_idx ON telemetry_events(event_type, occurred_at);
CREATE INDEX telemetry_events_repo_idx ON telemetry_events(repository, occurred_at);
CREATE INDEX telemetry_events_model_idx ON telemetry_events(provider, model, occurred_at);
CREATE INDEX telemetry_events_tool_idx ON telemetry_events(tool_name, occurred_at);
