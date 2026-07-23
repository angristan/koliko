import { Effect, Schema } from "effect"
import {
  ApiKeysResponse,
  AuthStatusResponse,
  DashboardResponse,
  SessionDetailResponse
} from "../shared/api"

const Descriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("public-key"),
  transports: Schema.optionalKey(Schema.Array(Schema.Literals([
    "ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"
  ])))
})

const RegistrationOptions = Schema.Struct({
  rp: Schema.Struct({ name: Schema.String, id: Schema.optionalKey(Schema.String) }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.String }),
  challenge: Schema.String,
  pubKeyCredParams: Schema.Array(Schema.Struct({ type: Schema.Literal("public-key"), alg: Schema.Number })),
  timeout: Schema.optionalKey(Schema.Number),
  excludeCredentials: Schema.optionalKey(Schema.Array(Descriptor)),
  authenticatorSelection: Schema.optionalKey(Schema.Struct({
    authenticatorAttachment: Schema.optionalKey(Schema.Literals(["cross-platform", "platform"])),
    residentKey: Schema.optionalKey(Schema.Literals(["discouraged", "preferred", "required"])),
    requireResidentKey: Schema.optionalKey(Schema.Boolean),
    userVerification: Schema.optionalKey(Schema.Literals(["discouraged", "preferred", "required"]))
  })),
  hints: Schema.optionalKey(Schema.Array(Schema.Literals(["hybrid", "security-key", "client-device"]))),
  attestation: Schema.optionalKey(Schema.Literals(["direct", "enterprise", "indirect", "none"]))
})

const AuthenticationOptions = Schema.Struct({
  challenge: Schema.String,
  timeout: Schema.optionalKey(Schema.Number),
  rpId: Schema.optionalKey(Schema.String),
  allowCredentials: Schema.optionalKey(Schema.Array(Descriptor)),
  userVerification: Schema.optionalKey(Schema.Literals(["discouraged", "preferred", "required"])),
  hints: Schema.optionalKey(Schema.Array(Schema.Literals(["hybrid", "security-key", "client-device"])))
})

export const ApiKeyCreated = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  prefix: Schema.String,
  createdAt: Schema.String
})

const Verified = Schema.Struct({ verified: Schema.Boolean })

export class ApiTransportError extends Schema.TaggedErrorClass<ApiTransportError>()(
  "ApiTransportError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.Defect()
  }
) {}

export class ApiStatusError extends Schema.TaggedErrorClass<ApiStatusError>()(
  "ApiStatusError",
  {
    path: Schema.String,
    status: Schema.Number,
    message: Schema.String
  }
) {}

export class ApiDecodeError extends Schema.TaggedErrorClass<ApiDecodeError>()(
  "ApiDecodeError",
  {
    path: Schema.String,
    message: Schema.String,
    cause: Schema.Defect()
  }
) {}

export class WebAuthnAdapterError extends Schema.TaggedErrorClass<WebAuthnAdapterError>()(
  "WebAuthnAdapterError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect()
  }
) {}

export type BrowserApiError = ApiTransportError | ApiStatusError | ApiDecodeError | WebAuthnAdapterError

const errorMessage = (body: unknown, status: number): string =>
  typeof body === "object" && body !== null && "error" in body
    && typeof body.error === "object" && body.error !== null && "message" in body.error
    && typeof body.error.message === "string"
    ? body.error.message
    : `Request failed with HTTP ${status}`

const requestUnknown = (path: string, init?: RequestInit) => Effect.gen(function*() {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json")

  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(path, {
      credentials: "same-origin",
      ...init,
      headers,
      signal
    }),
    catch: (cause) => ApiTransportError.make({
      path,
      message: `Could not reach ${path}`,
      cause
    })
  })

  if (response.status === 204) return null

  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => ApiTransportError.make({
      path,
      message: `Could not read the response from ${path}`,
      cause
    })
  })

  let body: unknown = null
  if (text.length > 0) {
    if (response.ok) {
      body = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => ApiDecodeError.make({
          path,
          message: `The response from ${path} was not valid JSON`,
          cause
        })
      })
    } else {
      try {
        body = JSON.parse(text) as unknown
      } catch {
        body = null
      }
    }
  }

  if (!response.ok) {
    return yield* ApiStatusError.make({
      path,
      status: response.status,
      message: errorMessage(body, response.status)
    })
  }

  return body
})

const request = <S extends Schema.Constraint>(schema: S, path: string, init?: RequestInit) =>
  requestUnknown(path, init).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError((cause) => ApiDecodeError.make({
        path,
        message: `The response from ${path} did not match the expected shape`,
        cause
      }))
    ))
  )

export const getAuthStatus = () => request(AuthStatusResponse, "/api/auth/status")

const registrationOptionsJson = (options: typeof RegistrationOptions.Type) => ({
  rp: { name: options.rp.name, ...(options.rp.id !== undefined ? { id: options.rp.id } : {}) },
  user: { ...options.user },
  challenge: options.challenge,
  pubKeyCredParams: options.pubKeyCredParams.map((parameter) => ({ ...parameter })),
  ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  ...(options.excludeCredentials !== undefined ? {
    excludeCredentials: options.excludeCredentials.map((credential) => ({
      id: credential.id,
      type: credential.type,
      ...(credential.transports !== undefined ? { transports: [...credential.transports] } : {})
    }))
  } : {}),
  ...(options.authenticatorSelection !== undefined ? {
    authenticatorSelection: { ...options.authenticatorSelection }
  } : {}),
  ...(options.hints !== undefined ? { hints: [...options.hints] } : {}),
  ...(options.attestation !== undefined ? { attestation: options.attestation } : {})
})

const createRegistrationCredential = (options: typeof RegistrationOptions.Type) => Effect.tryPromise({
  try: async () => {
    const { startRegistration } = await import("@simplewebauthn/browser")
    return startRegistration({ optionsJSON: registrationOptionsJson(options) })
  },
  catch: (cause) => WebAuthnAdapterError.make({
    operation: "register",
    message: "Passkey registration was canceled or failed",
    cause
  })
})

const authenticationOptionsJson = (options: typeof AuthenticationOptions.Type) => ({
  challenge: options.challenge,
  ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  ...(options.rpId !== undefined ? { rpId: options.rpId } : {}),
  ...(options.allowCredentials !== undefined ? {
    allowCredentials: options.allowCredentials.map((descriptor) => ({
      id: descriptor.id,
      type: descriptor.type,
      ...(descriptor.transports !== undefined ? { transports: [...descriptor.transports] } : {})
    }))
  } : {}),
  ...(options.userVerification !== undefined ? { userVerification: options.userVerification } : {}),
  ...(options.hints !== undefined ? { hints: [...options.hints] } : {})
})

const createAuthenticationCredential = (options: typeof AuthenticationOptions.Type) => Effect.tryPromise({
  try: async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser")
    return startAuthentication({ optionsJSON: authenticationOptionsJson(options) })
  },
  catch: (cause) => WebAuthnAdapterError.make({
    operation: "login",
    message: "Passkey authentication was canceled or failed",
    cause
  })
})

export const registerPasskey = (bootstrapToken?: string) => Effect.gen(function*() {
  const headers = bootstrapToken ? { "x-bootstrap-token": bootstrapToken } : undefined
  const options = yield* request(RegistrationOptions, "/api/auth/register/options", {
    method: "POST",
    headers
  })
  const credential = yield* createRegistrationCredential(options)
  const result = yield* request(Verified, "/api/auth/register/verify", {
    method: "POST",
    headers,
    body: JSON.stringify(credential)
  })

  if (!result.verified) {
    return yield* ApiStatusError.make({
      path: "/api/auth/register/verify",
      status: 400,
      message: "Passkey registration failed"
    })
  }
})

export const loginWithPasskey = () => Effect.gen(function*() {
  const options = yield* request(AuthenticationOptions, "/api/auth/login/options", { method: "POST" })
  const credential = yield* createAuthenticationCredential(options)
  const result = yield* request(Verified, "/api/auth/login/verify", {
    method: "POST",
    body: JSON.stringify(credential)
  })

  if (!result.verified) {
    return yield* ApiStatusError.make({
      path: "/api/auth/login/verify",
      status: 401,
      message: "Passkey authentication failed"
    })
  }
})

export const logout = () => requestUnknown("/api/auth/logout", { method: "POST" })

export const getDashboard = (from: string, to: string) =>
  request(DashboardResponse, `/api/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)

export const getSession = (id: string) =>
  request(SessionDetailResponse, `/api/sessions/${encodeURIComponent(id)}`)

export const getApiKeys = () => request(ApiKeysResponse, "/api/keys")

export const createApiKey = (name: string) =>
  request(ApiKeyCreated, "/api/keys", { method: "POST", body: JSON.stringify({ name }) })

export const revokeApiKey = (id: string) =>
  requestUnknown(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" })
