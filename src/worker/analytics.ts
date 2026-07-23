import { Effect, Schema } from "effect"
import {
  DailyMetric,
  FeatureMetric,
  SessionEvent,
  SessionMetric,
  SummaryMetrics,
  ToolMetric,
  UsageBreakdown
} from "../shared/api"
import { requireSession } from "./auth"
import { HttpFailure, json, type WorkerEnv } from "./http"

const AttributeValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])
const Attributes = Schema.Record(Schema.String, AttributeValue)

const invalidDatabaseResult = (): HttpFailure => HttpFailure.make({
  status: 500,
  code: "invalid_database_result",
  message: "Stored analytics data is invalid"
})

const queryFailed = (): HttpFailure => HttpFailure.make({
  status: 500,
  code: "query_failed",
  message: "Analytics query failed"
})

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Effect.Effect<S["Type"], HttpFailure> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(invalidDatabaseResult)
  )

const statement = (
  env: WorkerEnv,
  sql: string,
  bindings: ReadonlyArray<string> = []
): D1PreparedStatement => env.DB.prepare(sql).bind(...bindings)

const rows = <S extends Schema.ConstraintDecoder<unknown>>(
  env: WorkerEnv,
  sql: string,
  schema: S,
  bindings: ReadonlyArray<string> = []
): Effect.Effect<ReadonlyArray<S["Type"]>, HttpFailure> =>
  Effect.tryPromise({
    try: () => statement(env, sql, bindings).all(),
    catch: queryFailed
  }).pipe(
    Effect.flatMap((result) => decode(Schema.Array(schema), result.results))
  )

interface DateRange {
  readonly from: string
  readonly to: string
  readonly fromDate: string
  readonly toDate: string
}

const rangeFromRequest = (request: Request): Effect.Effect<DateRange, HttpFailure> => Effect.gen(function*() {
  const url = new URL(request.url)
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
  const fromValue = url.searchParams.get("from") ?? defaultFrom.toISOString().slice(0, 10)
  const toValue = url.searchParams.get("to") ?? now.toISOString().slice(0, 10)
  const from = new Date(`${fromValue}T00:00:00.000Z`)
  const inclusiveTo = new Date(`${toValue}T00:00:00.000Z`)

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(inclusiveTo.getTime()) || from > inclusiveTo) {
    return yield* HttpFailure.make({ status: 400, code: "invalid_date_range", message: "Date range is invalid" })
  }
  if (inclusiveTo.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return yield* HttpFailure.make({ status: 400, code: "date_range_too_large", message: "Date range cannot exceed 366 days" })
  }

  const toExclusive = new Date(inclusiveTo.getTime() + 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString(),
    to: toExclusive.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate: inclusiveTo.toISOString().slice(0, 10)
  }
})

const SUMMARY_SQL = `
  SELECT
    COUNT(DISTINCT session_id) AS sessions,
    COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0) AS turns,
    COALESCE(SUM(CASE WHEN event_type = 'agent_run' THEN duration_ms ELSE 0 END), 0) AS trackedMs,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN input_tokens ELSE 0 END), 0) AS inputTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN output_tokens ELSE 0 END), 0) AS outputTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_read_tokens ELSE 0 END), 0) AS cacheReadTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_write_tokens ELSE 0 END), 0) AS cacheWriteTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0) AS totalTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0) AS cost,
    COALESCE(SUM(CASE WHEN event_type = 'tool_execution' THEN 1 ELSE 0 END), 0) AS toolCalls,
    COALESCE(SUM(CASE WHEN event_type = 'tool_execution' AND status = 'error' THEN 1 ELSE 0 END), 0) AS toolErrors,
    COALESCE(SUM(CASE WHEN event_type = 'compaction' THEN 1 ELSE 0 END), 0) AS compactions,
    COALESCE(SUM(CASE WHEN event_type = 'goal' THEN 1 ELSE 0 END), 0) AS goals,
    COALESCE(SUM(CASE WHEN event_type = 'subagent' THEN 1 ELSE 0 END), 0) AS subagents
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ?`

const DAILY_SQL = `
  SELECT
    substr(occurred_at, 1, 10) AS date,
    COUNT(DISTINCT session_id) AS sessions,
    COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0) AS turns,
    COALESCE(SUM(CASE WHEN event_type = 'agent_run' THEN duration_ms ELSE 0 END), 0) AS trackedMs,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN input_tokens ELSE 0 END), 0) AS inputTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN output_tokens ELSE 0 END), 0) AS outputTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_read_tokens ELSE 0 END), 0) AS cacheReadTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cache_write_tokens ELSE 0 END), 0) AS cacheWriteTokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0) AS tokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0) AS cost,
    COALESCE(SUM(CASE WHEN event_type = 'tool_execution' THEN 1 ELSE 0 END), 0) AS toolCalls,
    COALESCE(SUM(CASE WHEN event_type = 'tool_execution' AND status = 'error' THEN 1 ELSE 0 END), 0) AS toolErrors,
    COALESCE(SUM(CASE WHEN event_type = 'compaction' THEN 1 ELSE 0 END), 0) AS compactions,
    COALESCE(SUM(CASE WHEN event_type = 'goal' THEN 1 ELSE 0 END), 0) AS goals,
    COALESCE(SUM(CASE WHEN event_type = 'subagent' THEN 1 ELSE 0 END), 0) AS subagents
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ?
  GROUP BY substr(occurred_at, 1, 10)
  ORDER BY date`

const breakdownSql = (keyExpression: string, labelExpression: string, filter = "event_type = 'usage'") => `
  SELECT
    ${keyExpression} AS key,
    ${labelExpression} AS label,
    COUNT(DISTINCT session_id) AS sessions,
    COALESCE(SUM(CASE WHEN event_type = 'usage' AND json_extract(attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0) AS turns,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN total_tokens ELSE 0 END), 0) AS tokens,
    COALESCE(SUM(CASE WHEN event_type = 'usage' THEN cost_total ELSE 0 END), 0) AS cost
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ? AND ${filter}
  GROUP BY ${keyExpression}, ${labelExpression}
  ORDER BY cost DESC, tokens DESC`

const TOOLS_SQL = `
  SELECT
    COALESCE(tool_name, 'unknown') AS name,
    COUNT(*) AS calls,
    COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
    COALESCE(SUM(duration_ms), 0) AS durationMs
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ? AND event_type = 'tool_execution'
  GROUP BY tool_name
  ORDER BY calls DESC, name
  LIMIT 50`

const FEATURES_SQL = `
  SELECT 'compaction' AS feature,
    COALESCE(json_extract(attributes_json, '$.reason'), 'unknown') AS label,
    COUNT(*) AS count,
    printf('%,d tokens before', COALESCE(ROUND(AVG(CAST(json_extract(attributes_json, '$.tokensBefore') AS REAL))), 0)) AS detail
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ? AND event_type = 'compaction'
  GROUP BY 2
  UNION ALL
  SELECT 'goal', COALESCE(status, 'observed'), COUNT(*), 'goal lifecycle events'
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ? AND event_type = 'goal'
  GROUP BY 2
  UNION ALL
  SELECT 'subagent', COALESCE(json_extract(attributes_json, '$.action'), 'observed'), COUNT(*), 'sub-agent lifecycle events'
  FROM telemetry_events
  WHERE occurred_at >= ? AND occurred_at < ? AND event_type = 'subagent'
  GROUP BY 2
  ORDER BY feature, count DESC`

const SESSIONS_SQL = `
  SELECT
    events.session_id AS id,
    MIN(events.repository) AS repository,
    MIN(events.occurred_at) AS startedAt,
    MAX(events.occurred_at) AS endedAt,
    COALESCE((
      SELECT COALESCE(latest.provider, '') || '/' || latest.model
      FROM telemetry_events AS latest
      WHERE latest.session_id = events.session_id AND latest.model IS NOT NULL
      ORDER BY latest.occurred_at DESC, latest.sequence DESC
      LIMIT 1
    ), 'unknown') AS model,
    COALESCE(SUM(CASE WHEN events.event_type = 'usage' AND json_extract(events.attributes_json, '$.source') = 'assistant' THEN 1 ELSE 0 END), 0) AS turns,
    COALESCE(SUM(CASE WHEN events.event_type = 'usage' THEN events.total_tokens ELSE 0 END), 0) AS tokens,
    COALESCE(SUM(CASE WHEN events.event_type = 'usage' THEN events.cost_total ELSE 0 END), 0) AS cost,
    COALESCE(SUM(CASE WHEN events.event_type = 'agent_run' THEN events.duration_ms ELSE 0 END), 0) AS trackedMs
  FROM telemetry_events AS events
  WHERE events.occurred_at >= ? AND events.occurred_at < ?
  GROUP BY events.session_id
  ORDER BY endedAt DESC
  LIMIT 50`

export const dashboard = Effect.fn("Analytics.dashboard")(function*(request: Request, env: WorkerEnv) {
  yield* requireSession(request, env)
  const range = yield* rangeFromRequest(request)
  const bindings = [range.from, range.to]
  const featureBindings = [...bindings, ...bindings, ...bindings]

  const queryResults = yield* Effect.tryPromise({
    try: () => env.DB.batch([
      statement(env, SUMMARY_SQL, bindings),
      statement(env, DAILY_SQL, bindings),
      statement(
        env,
        breakdownSql("COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown')", "COALESCE(provider, 'unknown') || '/' || COALESCE(model, 'unknown')"),
        bindings
      ),
      statement(
        env,
        breakdownSql("COALESCE(thinking_level, 'unknown')", "COALESCE(thinking_level, 'unknown')"),
        bindings
      ),
      statement(env, breakdownSql("repository", "repository", "1 = 1"), bindings),
      statement(env, TOOLS_SQL, bindings),
      statement(env, FEATURES_SQL, featureBindings),
      statement(env, SESSIONS_SQL, bindings)
    ]),
    catch: queryFailed
  })

  const [summaryResult, dailyResult, modelsResult, thinkingResult, repositoriesResult, toolsResult, featuresResult, sessionsResult] = queryResults
  if (!summaryResult || !dailyResult || !modelsResult || !thinkingResult || !repositoriesResult || !toolsResult || !featuresResult || !sessionsResult) {
    return yield* queryFailed()
  }

  const [summaryRows, daily, models, thinking, repositories, tools, features, sessions] = yield* Effect.all([
    decode(Schema.Array(SummaryMetrics), summaryResult.results),
    decode(Schema.Array(DailyMetric), dailyResult.results),
    decode(Schema.Array(UsageBreakdown), modelsResult.results),
    decode(Schema.Array(UsageBreakdown), thinkingResult.results),
    decode(Schema.Array(UsageBreakdown), repositoriesResult.results),
    decode(Schema.Array(ToolMetric), toolsResult.results),
    decode(Schema.Array(FeatureMetric), featuresResult.results),
    decode(Schema.Array(SessionMetric), sessionsResult.results)
  ], { concurrency: "unbounded" })

  const summary = summaryRows[0] ?? SummaryMetrics.make({
    sessions: 0,
    turns: 0,
    trackedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    toolCalls: 0,
    toolErrors: 0,
    compactions: 0,
    goals: 0,
    subagents: 0
  })

  return json({
    from: range.fromDate,
    to: range.toDate,
    summary,
    daily,
    models,
    thinking,
    repositories,
    tools,
    features,
    sessions
  })
})

const EventRow = Schema.Struct({
  event_id: Schema.String,
  occurred_at: Schema.String,
  event_type: Schema.String,
  repository: Schema.String,
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  thinking_level: Schema.NullOr(Schema.String),
  duration_ms: Schema.NullOr(Schema.Number),
  total_tokens: Schema.NullOr(Schema.Number),
  cost_total: Schema.NullOr(Schema.Number),
  tool_name: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  attributes_json: Schema.String
})

export const sessionDetail = Effect.fn("Analytics.sessionDetail")(function*(
  request: Request,
  env: WorkerEnv,
  sessionId: string
) {
  yield* requireSession(request, env)
  const selectedRows = yield* rows(
    env,
    `SELECT event_id, occurred_at, event_type, repository, provider, model, thinking_level,
      duration_ms, total_tokens, cost_total, tool_name, status, attributes_json
     FROM telemetry_events WHERE session_id = ? ORDER BY occurred_at DESC, sequence DESC LIMIT 501`,
    EventRow,
    [sessionId]
  )

  if (selectedRows.length === 0) {
    return yield* HttpFailure.make({ status: 404, code: "session_not_found", message: "Session was not found" })
  }

  const truncated = selectedRows.length > 500
  const eventRows = selectedRows.slice(0, 500).reverse()
  const events = yield* Effect.forEach(eventRows, (event) => {
    const attributes = Effect.try({
      try: () => JSON.parse(event.attributes_json) as unknown,
      catch: () => undefined
    }).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap((value) => value === undefined
        ? Effect.succeed({})
        : Schema.decodeUnknownEffect(Attributes)(value).pipe(Effect.orElseSucceed(() => ({}))))
    )

    return attributes.pipe(
      Effect.map((decoded) => SessionEvent.make({
        id: event.event_id,
        occurredAt: event.occurred_at,
        type: event.event_type,
        ...(event.provider !== null ? { provider: event.provider } : {}),
        ...(event.model !== null ? { model: event.model } : {}),
        ...(event.thinking_level !== null ? { thinkingLevel: event.thinking_level } : {}),
        ...(event.duration_ms !== null ? { durationMs: event.duration_ms } : {}),
        ...(event.total_tokens !== null ? { tokens: event.total_tokens } : {}),
        ...(event.cost_total !== null ? { cost: event.cost_total } : {}),
        ...(event.tool_name !== null ? { toolName: event.tool_name } : {}),
        ...(event.status !== null ? { status: event.status } : {}),
        attributes: decoded
      }))
    )
  }, { concurrency: "unbounded" })

  return json({ sessionId, repository: eventRows[0].repository, events, truncated })
})
