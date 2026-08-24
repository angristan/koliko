-- Dashboard queries used to scan telemetry_events once per panel. These append-only
-- rollups keep dashboard reads bounded while preserving telemetry_events as the
-- source of truth. AFTER INSERT triggers are idempotent with INSERT OR IGNORE:
-- SQLite does not run them when an event_id conflict suppresses the insert.

CREATE TABLE telemetry_daily_metrics (
  day TEXT PRIMARY KEY,
  event_count INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  tracked_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0,
  compactions INTEGER NOT NULL DEFAULT 0,
  goals INTEGER NOT NULL DEFAULT 0,
  subagents INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE telemetry_daily_session_metrics (
  day TEXT NOT NULL,
  session_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  tracked_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, session_id)
) WITHOUT ROWID;

CREATE TABLE telemetry_daily_dimensions (
  dimension TEXT NOT NULL CHECK (dimension IN ('model', 'thinking', 'repository')),
  day TEXT NOT NULL,
  value TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (dimension, day, value)
) WITHOUT ROWID;

CREATE TABLE telemetry_daily_dimension_sessions (
  dimension TEXT NOT NULL CHECK (dimension IN ('model', 'thinking', 'repository')),
  day TEXT NOT NULL,
  value TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (dimension, day, value, session_id)
) WITHOUT ROWID;

CREATE TABLE telemetry_daily_tools (
  day TEXT NOT NULL,
  name_missing INTEGER NOT NULL CHECK (name_missing IN (0, 1)),
  name TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name_missing, name)
) WITHOUT ROWID;

CREATE TABLE telemetry_daily_features (
  day TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('compaction', 'goal', 'subagent')),
  label NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  detail_total REAL NOT NULL DEFAULT 0,
  detail_samples INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature, label)
) WITHOUT ROWID;

CREATE TABLE telemetry_session_models (
  session_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL
) WITHOUT ROWID;

-- Backfill existing events before enabling incremental maintenance.
INSERT INTO telemetry_daily_metrics (
  day, event_count, turns, tracked_ms, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, total_tokens, cost, tool_calls, tool_errors,
  compactions, goals, subagents
)
SELECT
  substr(occurred_at, 1, 10),
  COUNT(*),
  COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'agent_run' THEN duration_ms ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN input_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN output_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_read_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_write_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'tool_execution' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'tool_execution' AND status = 'error' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'compaction' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'goal' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'subagent' THEN 1 ELSE 0 END), 0)
FROM telemetry_events
GROUP BY substr(occurred_at, 1, 10);

INSERT INTO telemetry_daily_session_metrics (
  day, session_id, repository, started_at, ended_at, event_count, turns, tokens, cost, tracked_ms
)
SELECT
  substr(occurred_at, 1, 10),
  session_id,
  MIN(repository),
  MIN(occurred_at),
  MAX(occurred_at),
  COUNT(*),
  COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'agent_run' THEN duration_ms ELSE 0 END), 0)
FROM telemetry_events
GROUP BY substr(occurred_at, 1, 10), session_id;

INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
SELECT
  'repository',
  substr(occurred_at, 1, 10),
  repository,
  COUNT(*),
  COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0)
FROM telemetry_events
GROUP BY substr(occurred_at, 1, 10), repository;

INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
SELECT
  'model',
  substr(occurred_at, 1, 10),
  COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown'),
  COUNT(*),
  COALESCE(SUM(CASE WHEN json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(total_tokens), 0),
  COALESCE(SUM(cost_total), 0)
FROM telemetry_events
WHERE event_type = 'usage'
GROUP BY substr(occurred_at, 1, 10), COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown');

INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
SELECT
  'thinking',
  substr(occurred_at, 1, 10),
  COALESCE(thinking_level, 'unknown'),
  COUNT(*),
  COALESCE(SUM(CASE WHEN json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(total_tokens), 0),
  COALESCE(SUM(cost_total), 0)
FROM telemetry_events
WHERE event_type = 'usage'
GROUP BY substr(occurred_at, 1, 10), COALESCE(thinking_level, 'unknown');

INSERT INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
SELECT DISTINCT 'repository', substr(occurred_at, 1, 10), repository, session_id
FROM telemetry_events;

INSERT INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
SELECT DISTINCT
  'model',
  substr(occurred_at, 1, 10),
  COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown'),
  session_id
FROM telemetry_events
WHERE event_type = 'usage';

INSERT INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
SELECT DISTINCT 'thinking', substr(occurred_at, 1, 10), COALESCE(thinking_level, 'unknown'), session_id
FROM telemetry_events
WHERE event_type = 'usage';

INSERT INTO telemetry_daily_tools (day, name_missing, name, calls, errors, duration_ms)
SELECT
  substr(occurred_at, 1, 10),
  tool_name IS NULL,
  COALESCE(tool_name, 'unknown'),
  COUNT(*),
  COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(duration_ms), 0)
FROM telemetry_events
WHERE event_type = 'tool_execution'
GROUP BY substr(occurred_at, 1, 10), tool_name;

INSERT INTO telemetry_daily_features (day, feature, label, count, detail_total, detail_samples)
SELECT
  substr(occurred_at, 1, 10),
  'compaction',
  COALESCE(json_extract(attributes_json, '$.reason'), 'unknown'),
  COUNT(*),
  COALESCE(SUM(CASE WHEN json_extract(attributes_json, '$.tokensBefore') IS NOT NULL THEN CAST(json_extract(attributes_json, '$.tokensBefore') AS REAL) ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN json_extract(attributes_json, '$.tokensBefore') IS NOT NULL THEN 1 ELSE 0 END), 0)
FROM telemetry_events
WHERE event_type = 'compaction'
GROUP BY substr(occurred_at, 1, 10), COALESCE(json_extract(attributes_json, '$.reason'), 'unknown');

INSERT INTO telemetry_daily_features (day, feature, label, count)
SELECT substr(occurred_at, 1, 10), 'goal', COALESCE(status, 'observed'), COUNT(*)
FROM telemetry_events
WHERE event_type = 'goal'
GROUP BY substr(occurred_at, 1, 10), COALESCE(status, 'observed');

INSERT INTO telemetry_daily_features (day, feature, label, count)
SELECT substr(occurred_at, 1, 10), 'subagent', COALESCE(json_extract(attributes_json, '$.action'), 'observed'), COUNT(*)
FROM telemetry_events
WHERE event_type = 'subagent'
GROUP BY substr(occurred_at, 1, 10), COALESCE(json_extract(attributes_json, '$.action'), 'observed');

INSERT INTO telemetry_session_models (session_id, model, occurred_at, sequence, event_id)
SELECT session_id, COALESCE(provider, '') || '/' || model, occurred_at, sequence, event_id
FROM (
  SELECT
    session_id,
    provider,
    model,
    occurred_at,
    sequence,
    event_id,
    ROW_NUMBER() OVER (
      PARTITION BY session_id
      ORDER BY occurred_at DESC, sequence DESC, event_id DESC
    ) AS position
  FROM telemetry_events
  WHERE model IS NOT NULL
)
WHERE position = 1;

CREATE TRIGGER telemetry_events_rollup_all_after_insert
AFTER INSERT ON telemetry_events
BEGIN
  INSERT INTO telemetry_daily_metrics (
    day, event_count, turns, tracked_ms, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, total_tokens, cost, tool_calls, tool_errors,
    compactions, goals, subagents
  ) VALUES (
    substr(NEW.occurred_at, 1, 10),
    1,
    CASE WHEN NEW.event_type = 'usage' AND json_extract(NEW.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'agent_run' THEN COALESCE(NEW.duration_ms, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.input_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.output_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.cache_read_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.cache_write_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.total_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.cost_total, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'tool_execution' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'tool_execution' AND NEW.status = 'error' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'compaction' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'goal' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'subagent' THEN 1 ELSE 0 END
  )
  ON CONFLICT (day) DO UPDATE SET
    event_count = event_count + excluded.event_count,
    turns = turns + excluded.turns,
    tracked_ms = tracked_ms + excluded.tracked_ms,
    input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens,
    cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
    total_tokens = total_tokens + excluded.total_tokens,
    cost = cost + excluded.cost,
    tool_calls = tool_calls + excluded.tool_calls,
    tool_errors = tool_errors + excluded.tool_errors,
    compactions = compactions + excluded.compactions,
    goals = goals + excluded.goals,
    subagents = subagents + excluded.subagents;

  INSERT INTO telemetry_daily_session_metrics (
    day, session_id, repository, started_at, ended_at, event_count, turns, tokens, cost, tracked_ms
  ) VALUES (
    substr(NEW.occurred_at, 1, 10),
    NEW.session_id,
    NEW.repository,
    NEW.occurred_at,
    NEW.occurred_at,
    1,
    CASE WHEN NEW.event_type = 'usage' AND json_extract(NEW.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.total_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.cost_total, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'agent_run' THEN COALESCE(NEW.duration_ms, 0) ELSE 0 END
  )
  ON CONFLICT (day, session_id) DO UPDATE SET
    repository = MIN(repository, excluded.repository),
    started_at = MIN(started_at, excluded.started_at),
    ended_at = MAX(ended_at, excluded.ended_at),
    event_count = event_count + excluded.event_count,
    turns = turns + excluded.turns,
    tokens = tokens + excluded.tokens,
    cost = cost + excluded.cost,
    tracked_ms = tracked_ms + excluded.tracked_ms;

  INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
  VALUES (
    'repository',
    substr(NEW.occurred_at, 1, 10),
    NEW.repository,
    1,
    CASE WHEN NEW.event_type = 'usage' AND json_extract(NEW.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.total_tokens, 0) ELSE 0 END,
    CASE WHEN NEW.event_type = 'usage' THEN COALESCE(NEW.cost_total, 0) ELSE 0 END
  )
  ON CONFLICT (dimension, day, value) DO UPDATE SET
    event_count = event_count + excluded.event_count,
    turns = turns + excluded.turns,
    tokens = tokens + excluded.tokens,
    cost = cost + excluded.cost;

  INSERT OR IGNORE INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
  VALUES ('repository', substr(NEW.occurred_at, 1, 10), NEW.repository, NEW.session_id);
END;

CREATE TRIGGER telemetry_events_rollup_usage_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'usage'
BEGIN
  INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
  VALUES (
    'model',
    substr(NEW.occurred_at, 1, 10),
    COALESCE(NEW.provider, 'unknown') || '/' || COALESCE(NEW.model, 'unknown'),
    1,
    CASE WHEN json_extract(NEW.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    COALESCE(NEW.total_tokens, 0),
    COALESCE(NEW.cost_total, 0)
  )
  ON CONFLICT (dimension, day, value) DO UPDATE SET
    event_count = event_count + excluded.event_count,
    turns = turns + excluded.turns,
    tokens = tokens + excluded.tokens,
    cost = cost + excluded.cost;

  INSERT INTO telemetry_daily_dimensions (dimension, day, value, event_count, turns, tokens, cost)
  VALUES (
    'thinking',
    substr(NEW.occurred_at, 1, 10),
    COALESCE(NEW.thinking_level, 'unknown'),
    1,
    CASE WHEN json_extract(NEW.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    COALESCE(NEW.total_tokens, 0),
    COALESCE(NEW.cost_total, 0)
  )
  ON CONFLICT (dimension, day, value) DO UPDATE SET
    event_count = event_count + excluded.event_count,
    turns = turns + excluded.turns,
    tokens = tokens + excluded.tokens,
    cost = cost + excluded.cost;

  INSERT OR IGNORE INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
  VALUES (
    'model',
    substr(NEW.occurred_at, 1, 10),
    COALESCE(NEW.provider, 'unknown') || '/' || COALESCE(NEW.model, 'unknown'),
    NEW.session_id
  );

  INSERT OR IGNORE INTO telemetry_daily_dimension_sessions (dimension, day, value, session_id)
  VALUES ('thinking', substr(NEW.occurred_at, 1, 10), COALESCE(NEW.thinking_level, 'unknown'), NEW.session_id);
END;

CREATE TRIGGER telemetry_events_rollup_tool_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'tool_execution'
BEGIN
  INSERT INTO telemetry_daily_tools (day, name_missing, name, calls, errors, duration_ms)
  VALUES (
    substr(NEW.occurred_at, 1, 10),
    NEW.tool_name IS NULL,
    COALESCE(NEW.tool_name, 'unknown'),
    1,
    CASE WHEN NEW.status = 'error' THEN 1 ELSE 0 END,
    COALESCE(NEW.duration_ms, 0)
  )
  ON CONFLICT (day, name_missing, name) DO UPDATE SET
    calls = calls + excluded.calls,
    errors = errors + excluded.errors,
    duration_ms = duration_ms + excluded.duration_ms;
END;

CREATE TRIGGER telemetry_events_rollup_compaction_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'compaction'
BEGIN
  INSERT INTO telemetry_daily_features (
    day, feature, label, count, detail_total, detail_samples
  ) VALUES (
    substr(NEW.occurred_at, 1, 10),
    'compaction',
    COALESCE(json_extract(NEW.attributes_json, '$.reason'), 'unknown'),
    1,
    CASE WHEN json_extract(NEW.attributes_json, '$.tokensBefore') IS NOT NULL THEN CAST(json_extract(NEW.attributes_json, '$.tokensBefore') AS REAL) ELSE 0 END,
    CASE WHEN json_extract(NEW.attributes_json, '$.tokensBefore') IS NOT NULL THEN 1 ELSE 0 END
  )
  ON CONFLICT (day, feature, label) DO UPDATE SET
    count = count + excluded.count,
    detail_total = detail_total + excluded.detail_total,
    detail_samples = detail_samples + excluded.detail_samples;
END;

CREATE TRIGGER telemetry_events_rollup_goal_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'goal'
BEGIN
  INSERT INTO telemetry_daily_features (day, feature, label, count)
  VALUES (substr(NEW.occurred_at, 1, 10), 'goal', COALESCE(NEW.status, 'observed'), 1)
  ON CONFLICT (day, feature, label) DO UPDATE SET count = count + excluded.count;
END;

CREATE TRIGGER telemetry_events_rollup_subagent_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'subagent'
BEGIN
  INSERT INTO telemetry_daily_features (day, feature, label, count)
  VALUES (
    substr(NEW.occurred_at, 1, 10),
    'subagent',
    COALESCE(json_extract(NEW.attributes_json, '$.action'), 'observed'),
    1
  )
  ON CONFLICT (day, feature, label) DO UPDATE SET count = count + excluded.count;
END;

CREATE TRIGGER telemetry_events_rollup_model_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.model IS NOT NULL
BEGIN
  INSERT INTO telemetry_session_models (session_id, model, occurred_at, sequence, event_id)
  VALUES (NEW.session_id, COALESCE(NEW.provider, '') || '/' || NEW.model, NEW.occurred_at, NEW.sequence, NEW.event_id)
  ON CONFLICT (session_id) DO UPDATE SET
    model = excluded.model,
    occurred_at = excluded.occurred_at,
    sequence = excluded.sequence,
    event_id = excluded.event_id
  WHERE excluded.occurred_at > telemetry_session_models.occurred_at
    OR (
      excluded.occurred_at = telemetry_session_models.occurred_at
      AND excluded.sequence > telemetry_session_models.sequence
    )
    OR (
      excluded.occurred_at = telemetry_session_models.occurred_at
      AND excluded.sequence = telemetry_session_models.sequence
      AND excluded.event_id > telemetry_session_models.event_id
    );
END;

-- Telemetry is normally append-only, but operators and the local seed script can
-- delete events. Reverse triggers prevent those maintenance operations from
-- leaving derived data behind.
CREATE TRIGGER telemetry_events_rollup_all_after_delete
AFTER DELETE ON telemetry_events
BEGIN
  UPDATE telemetry_daily_metrics SET
    event_count = event_count - 1,
    turns = turns - CASE WHEN OLD.event_type = 'usage' AND json_extract(OLD.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    tracked_ms = tracked_ms - CASE WHEN OLD.event_type = 'agent_run' THEN COALESCE(OLD.duration_ms, 0) ELSE 0 END,
    input_tokens = input_tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.input_tokens, 0) ELSE 0 END,
    output_tokens = output_tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.output_tokens, 0) ELSE 0 END,
    cache_read_tokens = cache_read_tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.cache_read_tokens, 0) ELSE 0 END,
    cache_write_tokens = cache_write_tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.cache_write_tokens, 0) ELSE 0 END,
    total_tokens = total_tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.total_tokens, 0) ELSE 0 END,
    cost = cost - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.cost_total, 0) ELSE 0 END,
    tool_calls = tool_calls - CASE WHEN OLD.event_type = 'tool_execution' THEN 1 ELSE 0 END,
    tool_errors = tool_errors - CASE WHEN OLD.event_type = 'tool_execution' AND OLD.status = 'error' THEN 1 ELSE 0 END,
    compactions = compactions - CASE WHEN OLD.event_type = 'compaction' THEN 1 ELSE 0 END,
    goals = goals - CASE WHEN OLD.event_type = 'goal' THEN 1 ELSE 0 END,
    subagents = subagents - CASE WHEN OLD.event_type = 'subagent' THEN 1 ELSE 0 END
  WHERE day = substr(OLD.occurred_at, 1, 10);

  DELETE FROM telemetry_daily_metrics
  WHERE day = substr(OLD.occurred_at, 1, 10) AND event_count = 0;

  UPDATE telemetry_daily_session_metrics SET
    repository = COALESCE((
      SELECT MIN(repository)
      FROM telemetry_events
      WHERE session_id = OLD.session_id
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
    ), repository),
    started_at = COALESCE((
      SELECT MIN(occurred_at)
      FROM telemetry_events
      WHERE session_id = OLD.session_id
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
    ), started_at),
    ended_at = COALESCE((
      SELECT MAX(occurred_at)
      FROM telemetry_events
      WHERE session_id = OLD.session_id
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
    ), ended_at),
    event_count = event_count - 1,
    turns = turns - CASE WHEN OLD.event_type = 'usage' AND json_extract(OLD.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    tokens = tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.total_tokens, 0) ELSE 0 END,
    cost = cost - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.cost_total, 0) ELSE 0 END,
    tracked_ms = tracked_ms - CASE WHEN OLD.event_type = 'agent_run' THEN COALESCE(OLD.duration_ms, 0) ELSE 0 END
  WHERE day = substr(OLD.occurred_at, 1, 10) AND session_id = OLD.session_id;

  DELETE FROM telemetry_daily_session_metrics
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND session_id = OLD.session_id
    AND event_count = 0;

  UPDATE telemetry_daily_dimensions SET
    event_count = event_count - 1,
    turns = turns - CASE WHEN OLD.event_type = 'usage' AND json_extract(OLD.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    tokens = tokens - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.total_tokens, 0) ELSE 0 END,
    cost = cost - CASE WHEN OLD.event_type = 'usage' THEN COALESCE(OLD.cost_total, 0) ELSE 0 END
  WHERE dimension = 'repository'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = OLD.repository;

  DELETE FROM telemetry_daily_dimensions
  WHERE dimension = 'repository'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = OLD.repository
    AND event_count = 0;

  DELETE FROM telemetry_daily_dimension_sessions
  WHERE dimension = 'repository'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = OLD.repository
    AND session_id = OLD.session_id
    AND NOT EXISTS (
      SELECT 1
      FROM telemetry_events
      WHERE session_id = OLD.session_id
        AND repository = OLD.repository
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
    );
END;

CREATE TRIGGER telemetry_events_rollup_usage_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'usage'
BEGIN
  UPDATE telemetry_daily_dimensions SET
    event_count = event_count - 1,
    turns = turns - CASE WHEN json_extract(OLD.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    tokens = tokens - COALESCE(OLD.total_tokens, 0),
    cost = cost - COALESCE(OLD.cost_total, 0)
  WHERE dimension = 'model'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.provider, 'unknown') || '/' || COALESCE(OLD.model, 'unknown');

  DELETE FROM telemetry_daily_dimensions
  WHERE dimension = 'model'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.provider, 'unknown') || '/' || COALESCE(OLD.model, 'unknown')
    AND event_count = 0;

  UPDATE telemetry_daily_dimensions SET
    event_count = event_count - 1,
    turns = turns - CASE WHEN json_extract(OLD.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END,
    tokens = tokens - COALESCE(OLD.total_tokens, 0),
    cost = cost - COALESCE(OLD.cost_total, 0)
  WHERE dimension = 'thinking'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.thinking_level, 'unknown');

  DELETE FROM telemetry_daily_dimensions
  WHERE dimension = 'thinking'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.thinking_level, 'unknown')
    AND event_count = 0;

  DELETE FROM telemetry_daily_dimension_sessions
  WHERE dimension = 'model'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.provider, 'unknown') || '/' || COALESCE(OLD.model, 'unknown')
    AND session_id = OLD.session_id
    AND NOT EXISTS (
      SELECT 1
      FROM telemetry_events
      WHERE event_type = 'usage'
        AND session_id = OLD.session_id
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
        AND COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown')
          = COALESCE(OLD.provider, 'unknown') || '/' || COALESCE(OLD.model, 'unknown')
    );

  DELETE FROM telemetry_daily_dimension_sessions
  WHERE dimension = 'thinking'
    AND day = substr(OLD.occurred_at, 1, 10)
    AND value = COALESCE(OLD.thinking_level, 'unknown')
    AND session_id = OLD.session_id
    AND NOT EXISTS (
      SELECT 1
      FROM telemetry_events
      WHERE event_type = 'usage'
        AND session_id = OLD.session_id
        AND occurred_at >= substr(OLD.occurred_at, 1, 10) || 'T00:00:00.000Z'
        AND occurred_at < date(substr(OLD.occurred_at, 1, 10), '+1 day') || 'T00:00:00.000Z'
        AND COALESCE(thinking_level, 'unknown') = COALESCE(OLD.thinking_level, 'unknown')
    );
END;

CREATE TRIGGER telemetry_events_rollup_tool_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'tool_execution'
BEGIN
  UPDATE telemetry_daily_tools SET
    calls = calls - 1,
    errors = errors - CASE WHEN OLD.status = 'error' THEN 1 ELSE 0 END,
    duration_ms = duration_ms - COALESCE(OLD.duration_ms, 0)
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND name_missing = (OLD.tool_name IS NULL)
    AND name = COALESCE(OLD.tool_name, 'unknown');

  DELETE FROM telemetry_daily_tools
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND name_missing = (OLD.tool_name IS NULL)
    AND name = COALESCE(OLD.tool_name, 'unknown')
    AND calls = 0;
END;

CREATE TRIGGER telemetry_events_rollup_compaction_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'compaction'
BEGIN
  UPDATE telemetry_daily_features SET
    count = count - 1,
    detail_total = detail_total - CASE WHEN json_extract(OLD.attributes_json, '$.tokensBefore') IS NOT NULL THEN CAST(json_extract(OLD.attributes_json, '$.tokensBefore') AS REAL) ELSE 0 END,
    detail_samples = detail_samples - CASE WHEN json_extract(OLD.attributes_json, '$.tokensBefore') IS NOT NULL THEN 1 ELSE 0 END
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'compaction'
    AND label = COALESCE(json_extract(OLD.attributes_json, '$.reason'), 'unknown');

  DELETE FROM telemetry_daily_features
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'compaction'
    AND label = COALESCE(json_extract(OLD.attributes_json, '$.reason'), 'unknown')
    AND count = 0;
END;

CREATE TRIGGER telemetry_events_rollup_goal_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'goal'
BEGIN
  UPDATE telemetry_daily_features SET count = count - 1
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'goal'
    AND label = COALESCE(OLD.status, 'observed');

  DELETE FROM telemetry_daily_features
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'goal'
    AND label = COALESCE(OLD.status, 'observed')
    AND count = 0;
END;

CREATE TRIGGER telemetry_events_rollup_subagent_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'subagent'
BEGIN
  UPDATE telemetry_daily_features SET count = count - 1
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'subagent'
    AND label = COALESCE(json_extract(OLD.attributes_json, '$.action'), 'observed');

  DELETE FROM telemetry_daily_features
  WHERE day = substr(OLD.occurred_at, 1, 10)
    AND feature = 'subagent'
    AND label = COALESCE(json_extract(OLD.attributes_json, '$.action'), 'observed')
    AND count = 0;
END;

CREATE TRIGGER telemetry_events_rollup_model_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.model IS NOT NULL
BEGIN
  DELETE FROM telemetry_session_models
  WHERE session_id = OLD.session_id AND event_id = OLD.event_id;

  INSERT INTO telemetry_session_models (session_id, model, occurred_at, sequence, event_id)
  SELECT
    session_id,
    COALESCE(provider, '') || '/' || model,
    occurred_at,
    sequence,
    event_id
  FROM telemetry_events
  WHERE session_id = OLD.session_id
    AND model IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM telemetry_session_models WHERE session_id = OLD.session_id
    )
  ORDER BY occurred_at DESC, sequence DESC, event_id DESC
  LIMIT 1;
END;
