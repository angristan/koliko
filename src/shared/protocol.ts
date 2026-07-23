import { Schema } from "effect"

export const TELEMETRY_SCHEMA_VERSION: 1 = 1

const Identifier = Schema.String.check(Schema.isLengthBetween(1, 128))
const Label = Schema.String.check(Schema.isMaxLength(255))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const IsoTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
  Schema.makeFilter(
    (value) => {
      try {
        return new Date(value).toISOString() === value
      } catch {
        return false
      }
    },
    { expected: "an ISO-8601 UTC timestamp" }
  )
)

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
  Label,
  NonNegativeNumber,
  Schema.Boolean,
  Schema.Null
])
const Attributes = Schema.Record(
  Schema.String.check(Schema.isLengthBetween(1, 64)),
  AttributeValue
).check(Schema.isMaxProperties(32))

export class TelemetryEvent extends Schema.Class<TelemetryEvent>("TelemetryEvent")({
  schemaVersion: Schema.Literal(TELEMETRY_SCHEMA_VERSION),
  id: Identifier,
  sessionId: Identifier,
  runtimeId: Identifier,
  sequence: NonNegativeInt,
  occurredAt: IsoTimestamp,
  type: TelemetryEventType,
  repository: Schema.String.check(Schema.isLengthBetween(1, 255)),
  provider: Schema.optionalKey(Label),
  model: Schema.optionalKey(Label),
  thinkingLevel: Schema.optionalKey(ThinkingLevel),
  durationMs: Schema.optionalKey(NonNegativeInt),
  inputTokens: Schema.optionalKey(NonNegativeInt),
  outputTokens: Schema.optionalKey(NonNegativeInt),
  cacheReadTokens: Schema.optionalKey(NonNegativeInt),
  cacheWriteTokens: Schema.optionalKey(NonNegativeInt),
  totalTokens: Schema.optionalKey(NonNegativeInt),
  costTotal: Schema.optionalKey(NonNegativeNumber),
  toolName: Schema.optionalKey(Label),
  status: Schema.optionalKey(Label),
  attributes: Schema.optionalKey(Attributes)
}) {}

export class IngestBatch extends Schema.Class<IngestBatch>("IngestBatch")({
  clientName: Schema.Literal("koliko-pi-extension"),
  clientVersion: Schema.String.check(Schema.isLengthBetween(1, 64)),
  events: Schema.Array(TelemetryEvent).check(Schema.isLengthBetween(1, 100))
}) {}

export class IngestAccepted extends Schema.Class<IngestAccepted>("IngestAccepted")({
  accepted: NonNegativeInt
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
  name: Schema.String.check(Schema.isTrimmed(), Schema.isLengthBetween(1, 80))
}) {}

export class DateRangeQuery extends Schema.Class<DateRangeQuery>("DateRangeQuery")({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString
}) {}
