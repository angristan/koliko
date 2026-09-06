-- Classify delegated Pi sessions separately without changing usage and cost totals.
-- Existing telemetry predates runtimeRole and is conservatively treated as parent work.

CREATE TABLE telemetry_session_context (
  session_id TEXT PRIMARY KEY,
  runtime_role TEXT NOT NULL CHECK (runtime_role IN ('parent', 'subagent')),
  parent_session_id TEXT,
  subagent_id TEXT
) WITHOUT ROWID;

INSERT INTO telemetry_session_context (session_id, runtime_role, parent_session_id, subagent_id)
SELECT
  session_id,
  CASE
    WHEN MAX(CASE WHEN json_extract(attributes_json, '$.runtimeRole') = 'subagent' THEN 1 ELSE 0 END) = 1
      THEN 'subagent'
    ELSE 'parent'
  END,
  MAX(CASE
    WHEN json_extract(attributes_json, '$.runtimeRole') = 'subagent'
      THEN json_extract(attributes_json, '$.parentSessionId')
  END),
  MAX(CASE
    WHEN json_extract(attributes_json, '$.runtimeRole') = 'subagent'
      THEN json_extract(attributes_json, '$.subagentId')
  END)
FROM telemetry_events
GROUP BY session_id;

CREATE TRIGGER telemetry_events_session_context_after_insert
AFTER INSERT ON telemetry_events
BEGIN
  INSERT INTO telemetry_session_context (session_id, runtime_role, parent_session_id, subagent_id)
  VALUES (
    NEW.session_id,
    CASE WHEN json_extract(NEW.attributes_json, '$.runtimeRole') = 'subagent' THEN 'subagent' ELSE 'parent' END,
    CASE WHEN json_extract(NEW.attributes_json, '$.runtimeRole') = 'subagent' THEN json_extract(NEW.attributes_json, '$.parentSessionId') END,
    CASE WHEN json_extract(NEW.attributes_json, '$.runtimeRole') = 'subagent' THEN json_extract(NEW.attributes_json, '$.subagentId') END
  )
  ON CONFLICT (session_id) DO UPDATE SET
    runtime_role = CASE
      WHEN excluded.runtime_role = 'subagent' THEN 'subagent'
      ELSE telemetry_session_context.runtime_role
    END,
    parent_session_id = COALESCE(excluded.parent_session_id, telemetry_session_context.parent_session_id),
    subagent_id = COALESCE(excluded.subagent_id, telemetry_session_context.subagent_id);
END;

CREATE TRIGGER telemetry_events_session_context_after_delete
AFTER DELETE ON telemetry_events
WHEN NOT EXISTS (SELECT 1 FROM telemetry_events WHERE session_id = OLD.session_id)
BEGIN
  DELETE FROM telemetry_session_context WHERE session_id = OLD.session_id;
END;

-- Keep lifecycle action counts in telemetry_daily_features. This rollup answers the
-- distinct question shown by the headline metric: how many agents were spawned?
CREATE TABLE telemetry_daily_subagent_spawns (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

INSERT INTO telemetry_daily_subagent_spawns (day, count)
SELECT
  substr(occurred_at, 1, 10),
  COALESCE(SUM(CAST(COALESCE(json_extract(attributes_json, '$.count'), 1) AS INTEGER)), 0)
FROM telemetry_events
WHERE event_type = 'subagent'
  AND COALESCE(status, 'success') <> 'error'
  AND json_extract(attributes_json, '$.action') IN ('spawn', 'single', 'parallel', 'chain')
GROUP BY substr(occurred_at, 1, 10);

CREATE TRIGGER telemetry_events_subagent_spawns_after_insert
AFTER INSERT ON telemetry_events
WHEN NEW.event_type = 'subagent'
  AND COALESCE(NEW.status, 'success') <> 'error'
  AND json_extract(NEW.attributes_json, '$.action') IN ('spawn', 'single', 'parallel', 'chain')
BEGIN
  INSERT INTO telemetry_daily_subagent_spawns (day, count)
  VALUES (
    substr(NEW.occurred_at, 1, 10),
    CAST(COALESCE(json_extract(NEW.attributes_json, '$.count'), 1) AS INTEGER)
  )
  ON CONFLICT (day) DO UPDATE SET count = count + excluded.count;
END;

CREATE TRIGGER telemetry_events_subagent_spawns_after_delete
AFTER DELETE ON telemetry_events
WHEN OLD.event_type = 'subagent'
  AND COALESCE(OLD.status, 'success') <> 'error'
  AND json_extract(OLD.attributes_json, '$.action') IN ('spawn', 'single', 'parallel', 'chain')
BEGIN
  UPDATE telemetry_daily_subagent_spawns
  SET count = count - CAST(COALESCE(json_extract(OLD.attributes_json, '$.count'), 1) AS INTEGER)
  WHERE day = substr(OLD.occurred_at, 1, 10);

  DELETE FROM telemetry_daily_subagent_spawns
  WHERE day = substr(OLD.occurred_at, 1, 10) AND count <= 0;
END;
