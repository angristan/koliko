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

  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: inclusiveTo.toISOString().slice(0, 10)
  }
})

const SUMMARY_SQL = `
  SELECT
    (
      SELECT COUNT(DISTINCT session_id)
      FROM telemetry_daily_session_metrics
      WHERE day >= ? AND day <= ?
    ) AS sessions,
    COALESCE(SUM(turns), 0) AS turns,
    COALESCE(SUM(tracked_ms), 0) AS trackedMs,
    COALESCE(SUM(input_tokens), 0) AS inputTokens,
    COALESCE(SUM(output_tokens), 0) AS outputTokens,
    COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
    COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
    COALESCE(SUM(total_tokens), 0) AS totalTokens,
    COALESCE(SUM(cost), 0) AS cost,
    COALESCE(SUM(tool_calls), 0) AS toolCalls,
    COALESCE(SUM(tool_errors), 0) AS toolErrors,
    COALESCE(SUM(compactions), 0) AS compactions,
    COALESCE(SUM(goals), 0) AS goals,
    COALESCE(SUM(subagents), 0) AS subagents
  FROM telemetry_daily_metrics
  WHERE day >= ? AND day <= ?`

const DAILY_SQL = `
  SELECT
    metrics.day AS date,
    COALESCE(sessions.count, 0) AS sessions,
    metrics.turns,
    metrics.tracked_ms AS trackedMs,
    metrics.input_tokens AS inputTokens,
    metrics.output_tokens AS outputTokens,
    metrics.cache_read_tokens AS cacheReadTokens,
    metrics.cache_write_tokens AS cacheWriteTokens,
    metrics.total_tokens AS tokens,
    metrics.cost,
    metrics.tool_calls AS toolCalls,
    metrics.tool_errors AS toolErrors,
    metrics.compactions,
    metrics.goals,
    metrics.subagents
  FROM telemetry_daily_metrics AS metrics
  LEFT JOIN (
    SELECT day, COUNT(*) AS count
    FROM telemetry_daily_session_metrics
    WHERE day >= ? AND day <= ?
    GROUP BY day
  ) AS sessions ON sessions.day = metrics.day
  WHERE metrics.day >= ? AND metrics.day <= ?
  ORDER BY metrics.day`

const breakdownSql = () => `
  WITH session_counts AS (
    SELECT value, COUNT(DISTINCT session_id) AS sessions
    FROM telemetry_daily_dimension_sessions
    WHERE dimension = ? AND day >= ? AND day <= ?
    GROUP BY value
  )
  SELECT
    metrics.value AS key,
    metrics.value AS label,
    COALESCE(session_counts.sessions, 0) AS sessions,
    COALESCE(SUM(metrics.turns), 0) AS turns,
    COALESCE(SUM(metrics.tokens), 0) AS tokens,
    COALESCE(SUM(metrics.cost), 0) AS cost
  FROM telemetry_daily_dimensions AS metrics
  LEFT JOIN session_counts ON session_counts.value = metrics.value
  WHERE metrics.dimension = ? AND metrics.day >= ? AND metrics.day <= ?
  GROUP BY metrics.value
  ORDER BY cost DESC, tokens DESC`

const TOOLS_SQL = `
  SELECT
    name,
    COALESCE(SUM(calls), 0) AS calls,
    COALESCE(SUM(errors), 0) AS errors,
    COALESCE(SUM(duration_ms), 0) AS durationMs
  FROM telemetry_daily_tools
  WHERE day >= ? AND day <= ?
  GROUP BY name_missing, name
  ORDER BY calls DESC, name
  LIMIT 50`

const FEATURES_SQL = `
  SELECT
    feature,
    label,
    COALESCE(SUM(count), 0) AS count,
    CASE feature
      WHEN 'compaction' THEN printf(
        '%,d tokens before',
        COALESCE(ROUND(SUM(detail_total) / NULLIF(SUM(detail_samples), 0)), 0)
      )
      WHEN 'goal' THEN 'goal lifecycle events'
      ELSE 'sub-agent lifecycle events'
    END AS detail
  FROM telemetry_daily_features
  WHERE day >= ? AND day <= ?
  GROUP BY feature, label
  ORDER BY feature, count DESC`

const SESSIONS_SQL = `
  SELECT
    sessions.session_id AS id,
    MIN(sessions.repository) AS repository,
    MIN(sessions.started_at) AS startedAt,
    MAX(sessions.ended_at) AS endedAt,
    COALESCE(MAX(models.model), 'unknown') AS model,
    COALESCE(SUM(sessions.turns), 0) AS turns,
    COALESCE(SUM(sessions.tokens), 0) AS tokens,
    COALESCE(SUM(sessions.cost), 0) AS cost,
    COALESCE(SUM(sessions.tracked_ms), 0) AS trackedMs
  FROM telemetry_daily_session_metrics AS sessions
  LEFT JOIN telemetry_session_models AS models ON models.session_id = sessions.session_id
  WHERE sessions.day >= ? AND sessions.day <= ?
  GROUP BY sessions.session_id
  ORDER BY endedAt DESC
  LIMIT 50`

export const dashboard = Effect.fn("Analytics.dashboard")(function*(request: Request, env: WorkerEnv) {
  yield* requireSession(request, env)
  const range = yield* rangeFromRequest(request)
  const dateBindings = [range.fromDate, range.toDate]
  const doubledDateBindings = [...dateBindings, ...dateBindings]
  const dimensionBindings = (dimension: "model" | "thinking" | "repository") => [
    dimension,
    ...dateBindings,
    dimension,
    ...dateBindings
  ]

  const queryResults = yield* Effect.tryPromise({
    try: () => env.DB.batch([
      statement(env, SUMMARY_SQL, doubledDateBindings),
      statement(env, DAILY_SQL, doubledDateBindings),
      statement(env, breakdownSql(), dimensionBindings("model")),
      statement(env, breakdownSql(), dimensionBindings("thinking")),
      statement(env, breakdownSql(), dimensionBindings("repository")),
      statement(env, TOOLS_SQL, dateBindings),
      statement(env, FEATURES_SQL, dateBindings),
      statement(env, SESSIONS_SQL, dateBindings)
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
