import * as Schema from "effect/Schema"

export * from "./telemetry-protocol"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

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
