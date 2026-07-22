import { Schema } from "effect"

export const TELEMETRY_SCHEMA_VERSION: 1 = 1

export const TelemetryEventType = Schema.Literals([
  "runtime_started",
  "runtime_ended",
  "agent_run",
  "usage",
  "model_selected",
  "thinking_selected",
  "compaction",
  "tool_execution",
  "goal",
  "subagent"
])

export const ThinkingLevel = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
])

const AttributeValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null
])

export class TelemetryEvent extends Schema.Class<TelemetryEvent>("TelemetryEvent")({
  schemaVersion: Schema.Literal(TELEMETRY_SCHEMA_VERSION),
  id: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  runtimeId: Schema.NonEmptyString,
  sequence: Schema.Number,
  occurredAt: Schema.NonEmptyString,
  type: TelemetryEventType,
  repository: Schema.NonEmptyString,
  provider: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  thinkingLevel: Schema.optionalKey(ThinkingLevel),
  durationMs: Schema.optionalKey(Schema.Number),
  inputTokens: Schema.optionalKey(Schema.Number),
  outputTokens: Schema.optionalKey(Schema.Number),
  cacheReadTokens: Schema.optionalKey(Schema.Number),
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
  totalTokens: Schema.optionalKey(Schema.Number),
  costTotal: Schema.optionalKey(Schema.Number),
  toolName: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(Schema.Record(Schema.String, AttributeValue))
}) {}

export class IngestBatch extends Schema.Class<IngestBatch>("IngestBatch")({
  clientName: Schema.Literal("traker-pi-extension"),
  clientVersion: Schema.NonEmptyString,
  events: Schema.Array(TelemetryEvent)
}) {}

const Transport = Schema.Literals([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb"
])

const AuthenticatorAttachment = Schema.Literals(["cross-platform", "platform"])

export class RegistrationCredentialPayload extends Schema.Class<RegistrationCredentialPayload>(
  "RegistrationCredentialPayload"
)({
  id: Schema.NonEmptyString,
  rawId: Schema.NonEmptyString,
  response: Schema.Struct({
    clientDataJSON: Schema.NonEmptyString,
    attestationObject: Schema.NonEmptyString,
    authenticatorData: Schema.optionalKey(Schema.String),
    transports: Schema.optionalKey(Schema.Array(Transport)),
    publicKeyAlgorithm: Schema.optionalKey(Schema.Number),
    publicKey: Schema.optionalKey(Schema.String)
  }),
  authenticatorAttachment: Schema.optionalKey(AuthenticatorAttachment),
  type: Schema.Literal("public-key")
}) {}

export class AuthenticationCredentialPayload extends Schema.Class<AuthenticationCredentialPayload>(
  "AuthenticationCredentialPayload"
)({
  id: Schema.NonEmptyString,
  rawId: Schema.NonEmptyString,
  response: Schema.Struct({
    clientDataJSON: Schema.NonEmptyString,
    authenticatorData: Schema.NonEmptyString,
    signature: Schema.NonEmptyString,
    userHandle: Schema.optionalKey(Schema.String)
  }),
  authenticatorAttachment: Schema.optionalKey(AuthenticatorAttachment),
  type: Schema.Literal("public-key")
}) {}

export class ApiKeyCreatePayload extends Schema.Class<ApiKeyCreatePayload>("ApiKeyCreatePayload")({
  name: Schema.NonEmptyString
}) {}

export class DateRangeQuery extends Schema.Class<DateRangeQuery>("DateRangeQuery")({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString
}) {}
