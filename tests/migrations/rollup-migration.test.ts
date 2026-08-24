import { env } from "cloudflare:workers"
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
  waitOnExecutionContext
} from "cloudflare:test"
import { expect, it } from "vitest"
import worker from "../../src/worker/index"
import { signValue } from "../../src/worker/crypto"

declare const TEST_D1_MIGRATIONS: D1Migration[]

const legacyMigrations = TEST_D1_MIGRATIONS.filter(
  (migration) => migration.name !== "0004_analytics_rollups.sql"
)

const sessionCookie = async (): Promise<string> => {
  const token = await signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + 60_000
  })
  return `koliko_session=${encodeURIComponent(token)}`
}

const fetchWorker = async (request: Request): Promise<Response> => {
  const context = createExecutionContext()
  const response = await worker.fetch(request, env, context)
  await waitOnExecutionContext(context)
  return response
}

it("backfills rollups for telemetry stored before the migration", async () => {
  await applyD1Migrations(env.DB, legacyMigrations)
  await env.DB.prepare(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at)
     VALUES ('key_1', 'Legacy collector', 'legacy', 'hash', '2026-07-21T00:00:00.000Z')`
  ).run()

  const insertEvent = (values: ReadonlyArray<string | number | null>) => env.DB.prepare(
    `INSERT INTO telemetry_events (
      event_id, schema_version, api_key_id, session_id, runtime_id, sequence,
      occurred_at, event_type, repository, provider, model, thinking_level,
      duration_ms, total_tokens, cost_total, tool_name, status, attributes_json
    ) VALUES (?, 1, 'key_1', ?, 'runtime_1', ?, ?, ?, 'koliko', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(...values)

  await env.DB.batch([
    insertEvent([
      "usage_day_1", "session_1", 1, "2026-07-21T23:59:59.999Z", "usage",
      "provider", "model", "high", null, 10, 0.1, null, null, '{"source":"assistant"}'
    ]),
    insertEvent([
      "usage_day_2", "session_1", 2, "2026-07-22T00:00:00.000Z", "usage",
      "provider", "model", "high", null, 20, 0.2, null, null, '{"source":"assistant"}'
    ]),
    insertEvent([
      "tool_missing", "session_1", 3, "2026-07-21T12:00:00.000Z", "tool_execution",
      null, null, null, 5, null, null, null, "completed", "{}"
    ]),
    insertEvent([
      "tool_literal_unknown", "session_1", 4, "2026-07-21T12:01:00.000Z", "tool_execution",
      null, null, null, 7, null, null, "unknown", "error", "{}"
    ]),
    insertEvent([
      "compaction", "session_1", 5, "2026-07-21T12:02:00.000Z", "compaction",
      null, null, null, null, null, null, null, "completed", '{"reason":"manual","tokensBefore":100}'
    ]),
    insertEvent([
      "compaction_numeric_label", "session_1", 6, "2026-07-21T12:03:00.000Z", "compaction",
      null, null, null, null, null, null, null, "completed", '{"reason":1,"tokensBefore":200}'
    ]),
    insertEvent([
      "compaction_text_label", "session_1", 7, "2026-07-21T12:04:00.000Z", "compaction",
      null, null, null, null, null, null, null, "completed", '{"reason":"1","tokensBefore":300}'
    ]),
    insertEvent([
      "latest_model", "session_1", 8, "2026-07-23T00:00:00.000Z", "model_selected",
      "provider", "latest", null, null, null, null, null, null, "{}"
    ])
  ])

  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS)

  const typedLabels = await env.DB.prepare(
    `SELECT typeof(label) AS type, detail_total AS detailTotal
     FROM telemetry_daily_features
     WHERE feature = 'compaction' AND CAST(label AS TEXT) = '1'
     ORDER BY type`
  ).all()
  expect(typedLabels.results).toEqual([
    { type: "integer", detailTotal: 200 },
    { type: "text", detailTotal: 300 }
  ])
  await env.DB.prepare(
    "DELETE FROM telemetry_events WHERE event_id IN ('compaction_numeric_label', 'compaction_text_label')"
  ).run()

  const response = await fetchWorker(new Request(
    "https://example.test/api/dashboard?from=2026-07-21&to=2026-07-22",
    { headers: { cookie: await sessionCookie() } }
  ))
  expect(response.status).toBe(200)
  const dashboard = await response.json() as {
    summary: { sessions: number; turns: number; totalTokens: number; cost: number; toolCalls: number }
    daily: Array<{ date: string; sessions: number }>
    tools: Array<{ name: string; calls: number }>
    features: Array<{ feature: string; label: string; count: number; detail: string }>
    sessions: Array<{ id: string; model: string; turns: number; tokens: number }>
  }

  expect(dashboard.summary).toMatchObject({
    sessions: 1,
    turns: 2,
    totalTokens: 30,
    toolCalls: 2
  })
  expect(dashboard.summary.cost).toBeCloseTo(0.3)
  expect(dashboard.daily).toEqual([
    expect.objectContaining({ date: "2026-07-21", sessions: 1 }),
    expect.objectContaining({ date: "2026-07-22", sessions: 1 })
  ])
  expect(dashboard.tools).toHaveLength(2)
  expect(dashboard.tools.every((tool) => tool.name === "unknown" && tool.calls === 1)).toBe(true)
  expect(dashboard.features).toContainEqual({
    feature: "compaction",
    label: "manual",
    count: 1,
    detail: "100 tokens before"
  })
  expect(dashboard.sessions).toEqual([expect.objectContaining({
    id: "session_1",
    model: "provider/latest",
    turns: 2,
    tokens: 30
  })])

  // The migration runner must not replay the historical backfill once recorded.
  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS)
  const totalTokens = await env.DB.prepare(
    "SELECT SUM(total_tokens) AS total FROM telemetry_daily_metrics"
  ).first<number>("total")
  expect(totalTokens).toBe(30)

  await env.DB.prepare("DELETE FROM telemetry_events WHERE event_id = 'latest_model'").run()
  const previousModel = await env.DB.prepare(
    "SELECT model FROM telemetry_session_models WHERE session_id = 'session_1'"
  ).first<string>("model")
  expect(previousModel).toBe("provider/model")

  await env.DB.prepare("DELETE FROM telemetry_events WHERE session_id = 'session_1'").run()
  const remainingRollupRows = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM telemetry_daily_metrics)
      + (SELECT COUNT(*) FROM telemetry_daily_session_metrics)
      + (SELECT COUNT(*) FROM telemetry_daily_dimensions)
      + (SELECT COUNT(*) FROM telemetry_daily_dimension_sessions)
      + (SELECT COUNT(*) FROM telemetry_daily_tools)
      + (SELECT COUNT(*) FROM telemetry_daily_features)
      + (SELECT COUNT(*) FROM telemetry_session_models) AS count`
  ).first<number>("count")
  expect(remainingRollupRows).toBe(0)
})
