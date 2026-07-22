import { Schema } from "effect"

export class SummaryMetrics extends Schema.Class<SummaryMetrics>("SummaryMetrics")({
  sessions: Schema.Number,
  turns: Schema.Number,
  trackedMs: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Number,
  toolCalls: Schema.Number,
  toolErrors: Schema.Number,
  compactions: Schema.Number,
  goals: Schema.Number,
  subagents: Schema.Number
}) {}

export class DailyMetric extends Schema.Class<DailyMetric>("DailyMetric")({
  date: Schema.String,
  sessions: Schema.Number,
  trackedMs: Schema.Number,
  tokens: Schema.Number,
  cost: Schema.Number
}) {}

export class UsageBreakdown extends Schema.Class<UsageBreakdown>("UsageBreakdown")({
  key: Schema.String,
  label: Schema.String,
  sessions: Schema.Number,
  turns: Schema.Number,
  tokens: Schema.Number,
  cost: Schema.Number
}) {}

export class ToolMetric extends Schema.Class<ToolMetric>("ToolMetric")({
  name: Schema.String,
  calls: Schema.Number,
  errors: Schema.Number,
  durationMs: Schema.Number
}) {}

export class FeatureMetric extends Schema.Class<FeatureMetric>("FeatureMetric")({
  feature: Schema.String,
  label: Schema.String,
  count: Schema.Number,
  detail: Schema.String
}) {}

export class SessionMetric extends Schema.Class<SessionMetric>("SessionMetric")({
  id: Schema.String,
  repository: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.String,
  model: Schema.String,
  turns: Schema.Number,
  tokens: Schema.Number,
  cost: Schema.Number,
  trackedMs: Schema.Number
}) {}

export class DashboardResponse extends Schema.Class<DashboardResponse>("DashboardResponse")({
  from: Schema.String,
  to: Schema.String,
  summary: SummaryMetrics,
  daily: Schema.Array(DailyMetric),
  models: Schema.Array(UsageBreakdown),
  thinking: Schema.Array(UsageBreakdown),
  repositories: Schema.Array(UsageBreakdown),
  tools: Schema.Array(ToolMetric),
  features: Schema.Array(FeatureMetric),
  sessions: Schema.Array(SessionMetric)
}) {}

export class SessionEvent extends Schema.Class<SessionEvent>("SessionEvent")({
  id: Schema.String,
  occurredAt: Schema.String,
  type: Schema.String,
  provider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  thinkingLevel: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Number),
  tokens: Schema.optionalKey(Schema.Number),
  cost: Schema.optionalKey(Schema.Number),
  toolName: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]))
}) {}

export class SessionDetailResponse extends Schema.Class<SessionDetailResponse>("SessionDetailResponse")({
  sessionId: Schema.String,
  repository: Schema.String,
  events: Schema.Array(SessionEvent),
  truncated: Schema.Boolean
}) {}

export class ApiKeySummary extends Schema.Class<ApiKeySummary>("ApiKeySummary")({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String)
}) {}

export class ApiKeysResponse extends Schema.Class<ApiKeysResponse>("ApiKeysResponse")({
  keys: Schema.Array(ApiKeySummary)
}) {}

export class AuthStatusResponse extends Schema.Class<AuthStatusResponse>("AuthStatusResponse")({
  authenticated: Schema.Boolean,
  hasPasskey: Schema.Boolean
}) {}
