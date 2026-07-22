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
  hints: Schema.optionalKey(Schema.Array(Schema.Literals(["hybrid", "security-key", "client-device"]))),
})

const ApiKeyCreated = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  prefix: Schema.String,
  createdAt: Schema.String
})

const Verified = Schema.Struct({ verified: Schema.Boolean })

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

const requestUnknown = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  })

  if (response.status === 204) return null
  const body: unknown = await response.json()
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      && typeof body.error === "object" && body.error !== null && "message" in body.error
      && typeof body.error.message === "string"
      ? body.error.message
      : `Request failed with HTTP ${response.status}`
    throw new ApiError(message, response.status)
  }
  return body
}

const request = async <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  path: string,
  init?: RequestInit
): Promise<S["Type"]> => {
  const body = await requestUnknown(path, init)
  return Effect.runPromise(Schema.decodeUnknownEffect(schema)(body))
}

export const getAuthStatus = (): Promise<AuthStatusResponse> =>
  request(AuthStatusResponse, "/api/auth/status")

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

export const registerPasskey = async (bootstrapToken?: string): Promise<void> => {
  const headers = bootstrapToken ? { "x-bootstrap-token": bootstrapToken } : undefined
  const options = await request(RegistrationOptions, "/api/auth/register/options", {
    method: "POST",
    headers
  })
  const { startRegistration } = await import("@simplewebauthn/browser")
  const credential = await startRegistration({ optionsJSON: registrationOptionsJson(options) })
  const result = await request(Verified, "/api/auth/register/verify", {
    method: "POST",
    headers,
    body: JSON.stringify(credential)
  })
  if (!result.verified) throw new ApiError("Passkey registration failed", 400)
}

export const loginWithPasskey = async (): Promise<void> => {
  const options = await request(AuthenticationOptions, "/api/auth/login/options", { method: "POST" })
  const { startAuthentication } = await import("@simplewebauthn/browser")
  const credential = await startAuthentication({
    optionsJSON: {
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
    }
  })
  const result = await request(Verified, "/api/auth/login/verify", {
    method: "POST",
    body: JSON.stringify(credential)
  })
  if (!result.verified) throw new ApiError("Passkey authentication failed", 401)
}

export const logout = (): Promise<unknown> => requestUnknown("/api/auth/logout", { method: "POST" })

export const getDashboard = (from: string, to: string): Promise<DashboardResponse> =>
  request(DashboardResponse, `/api/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)

export const getSession = (id: string): Promise<SessionDetailResponse> =>
  request(SessionDetailResponse, `/api/sessions/${encodeURIComponent(id)}`)

export const getApiKeys = (): Promise<ApiKeysResponse> => request(ApiKeysResponse, "/api/keys")

export const createApiKey = (name: string): Promise<typeof ApiKeyCreated.Type> =>
  request(ApiKeyCreated, "/api/keys", { method: "POST", body: JSON.stringify({ name }) })

export const revokeApiKey = (id: string): Promise<unknown> =>
  requestUnknown(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" })
