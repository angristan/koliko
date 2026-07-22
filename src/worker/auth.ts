import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server"
import { Effect, Schema } from "effect"
import {
  ApiKeyCreatePayload,
  AuthenticationCredentialPayload,
  RegistrationCredentialPayload
} from "../shared/protocol"
import { fromBase64Url, randomToken, safeSecretEqual, sha256, signValue, toBase64Url, verifySignedValue } from "./crypto"
import {
  assertSameOrigin,
  clearCookie,
  getCookie,
  HttpFailure,
  json,
  makeCookie,
  noContent,
  readJson,
  type WorkerEnv
} from "./http"

const SESSION_COOKIE = "traker_session"
const CHALLENGE_COOKIE = "traker_challenge"
const SESSION_SECONDS = 60 * 60 * 24 * 7
const CHALLENGE_SECONDS = 60 * 5
const publicKeyCredentialType: "public-key" = "public-key"

const ChallengeClaims = Schema.Struct({
  kind: Schema.Literal("challenge"),
  purpose: Schema.Literals(["registration", "authentication"]),
  challenge: Schema.String,
  expiresAt: Schema.Number
})

const SessionClaims = Schema.Struct({
  kind: Schema.Literal("session"),
  expiresAt: Schema.Number
})

const PasskeyRow = Schema.Struct({
  credential_id: Schema.String,
  public_key: Schema.String,
  counter: Schema.Number,
  transports: Schema.String,
  device_type: Schema.String,
  backed_up: Schema.Number,
  created_at: Schema.String,
  last_used_at: Schema.NullOr(Schema.String)
})

const ApiKeyRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key_prefix: Schema.String,
  created_at: Schema.String,
  last_used_at: Schema.NullOr(Schema.String),
  revoked_at: Schema.NullOr(Schema.String)
})

const Transports = Schema.Array(Schema.Literals([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb"
]))

const decode = async <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Promise<S["Type"]> => {
  try {
    return await Schema.decodeUnknownPromise(schema)(input)
  } catch {
    throw HttpFailure.make({ status: 400, code: "invalid_request", message: "Request payload is invalid" })
  }
}

const countPasskeys = async (env: WorkerEnv): Promise<number> => {
  const row: unknown = await env.DB.prepare("SELECT COUNT(*) AS count FROM passkeys").first()
  const decoded = await decode(Schema.NullOr(Schema.Struct({ count: Schema.Number })), row)
  return decoded?.count ?? 0
}

const hasValidSession = async (request: Request, env: WorkerEnv): Promise<boolean> => {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return false
  const value = await verifySignedValue(env.SESSION_SECRET, token)

  try {
    const claims = await Effect.runPromise(Schema.decodeUnknownEffect(SessionClaims)(value))
    return claims.expiresAt > Date.now()
  } catch {
    return false
  }
}

export const requireSession = async (request: Request, env: WorkerEnv): Promise<void> => {
  if (!(await hasValidSession(request, env))) {
    throw HttpFailure.make({ status: 401, code: "unauthorized", message: "Passkey authentication is required" })
  }
}

const requireBootstrapOrSession = async (request: Request, env: WorkerEnv): Promise<void> => {
  if ((await countPasskeys(env)) > 0) {
    await requireSession(request, env)
    return
  }

  const token = request.headers.get("x-bootstrap-token") ?? ""
  if (!token || !(await safeSecretEqual(token, env.BOOTSTRAP_TOKEN))) {
    throw HttpFailure.make({ status: 401, code: "invalid_bootstrap_token", message: "Bootstrap token is invalid" })
  }
}

const challengeCookie = async (
  env: WorkerEnv,
  purpose: "registration" | "authentication",
  challenge: string
): Promise<string> => {
  const value = await signValue(env.SESSION_SECRET, {
    kind: "challenge",
    purpose,
    challenge,
    expiresAt: Date.now() + CHALLENGE_SECONDS * 1000
  })
  return makeCookie(CHALLENGE_COOKIE, value, env.EXPECTED_ORIGIN, CHALLENGE_SECONDS)
}

const readChallenge = async (
  request: Request,
  env: WorkerEnv,
  purpose: "registration" | "authentication"
): Promise<string> => {
  const token = getCookie(request, CHALLENGE_COOKIE)
  const value = token ? await verifySignedValue(env.SESSION_SECRET, token) : undefined

  try {
    const claims = await Effect.runPromise(Schema.decodeUnknownEffect(ChallengeClaims)(value))
    if (claims.purpose !== purpose || claims.expiresAt <= Date.now()) throw new Error("expired")
    return claims.challenge
  } catch {
    throw HttpFailure.make({ status: 400, code: "invalid_challenge", message: "Passkey challenge expired or is invalid" })
  }
}

const listPasskeyRows = async (env: WorkerEnv) => {
  const result = await env.DB.prepare("SELECT * FROM passkeys ORDER BY created_at").all()
  return decode(Schema.Array(PasskeyRow), result.results)
}

const parseTransports = async (encoded: string) => {
  let value: unknown
  try {
    value = JSON.parse(encoded)
  } catch {
    throw HttpFailure.make({ status: 500, code: "invalid_passkey", message: "Stored passkey data is invalid" })
  }
  return decode(Transports, value)
}

export const authStatus = async (request: Request, env: WorkerEnv): Promise<Response> =>
  json({
    authenticated: await hasValidSession(request, env),
    hasPasskey: (await countPasskeys(env)) > 0
  })

export const registrationOptions = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  await requireBootstrapOrSession(request, env)

  const passkeys = await listPasskeyRows(env)
  const excludeCredentials = await Promise.all(passkeys.map(async (passkey) => ({
    id: passkey.credential_id,
    transports: [...await parseTransports(passkey.transports)]
  })))
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: "owner",
    userDisplayName: "Traker owner",
    userID: new TextEncoder().encode("traker-owner"),
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required"
    }
  })

  return json(options, {
    headers: { "set-cookie": await challengeCookie(env, "registration", options.challenge) }
  })
}

export const verifyRegistration = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  await requireBootstrapOrSession(request, env)
  const challenge = await readChallenge(request, env, "registration")
  const payload = await decode(RegistrationCredentialPayload, await readJson(request))

  const response = {
    id: payload.id,
    rawId: payload.rawId,
    response: {
      clientDataJSON: payload.response.clientDataJSON,
      attestationObject: payload.response.attestationObject,
      ...(payload.response.authenticatorData !== undefined
        ? { authenticatorData: payload.response.authenticatorData }
        : {}),
      ...(payload.response.transports !== undefined
        ? { transports: [...payload.response.transports] }
        : {}),
      ...(payload.response.publicKeyAlgorithm !== undefined
        ? { publicKeyAlgorithm: payload.response.publicKeyAlgorithm }
        : {}),
      ...(payload.response.publicKey !== undefined ? { publicKey: payload.response.publicKey } : {})
    },
    clientExtensionResults: {},
    type: publicKeyCredentialType
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.EXPECTED_ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true
  })

  if (!verification.verified) {
    throw HttpFailure.make({ status: 400, code: "registration_failed", message: "Passkey registration could not be verified" })
  }

  const now = new Date().toISOString()
  const credential = verification.registrationInfo.credential
  await env.DB.prepare(
    `INSERT INTO passkeys
      (credential_id, public_key, counter, transports, device_type, backed_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    credential.id,
    toBase64Url(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    verification.registrationInfo.credentialDeviceType,
    verification.registrationInfo.credentialBackedUp ? 1 : 0,
    now
  ).run()

  const session = await signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  })
  return json({ verified: true }, {
    headers: {
      "set-cookie": makeCookie(SESSION_COOKIE, session, env.EXPECTED_ORIGIN, SESSION_SECONDS)
    }
  })
}

export const authenticationOptions = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  const passkeys = await listPasskeyRows(env)
  if (passkeys.length === 0) {
    throw HttpFailure.make({ status: 409, code: "setup_required", message: "Register the first passkey before signing in" })
  }

  const allowCredentials = await Promise.all(passkeys.map(async (passkey) => ({
    id: passkey.credential_id,
    transports: [...await parseTransports(passkey.transports)]
  })))
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "required",
    allowCredentials
  })

  return json(options, {
    headers: { "set-cookie": await challengeCookie(env, "authentication", options.challenge) }
  })
}

export const verifyAuthentication = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  const challenge = await readChallenge(request, env, "authentication")
  const payload = await decode(AuthenticationCredentialPayload, await readJson(request))
  const raw: unknown = await env.DB.prepare("SELECT * FROM passkeys WHERE credential_id = ?")
    .bind(payload.id)
    .first()
  const passkey = await decode(Schema.NullOr(PasskeyRow), raw)
  if (!passkey) {
    throw HttpFailure.make({ status: 401, code: "unknown_passkey", message: "Passkey is not registered" })
  }
  const transports = await decode(Transports, JSON.parse(passkey.transports))

  const response = {
    id: payload.id,
    rawId: payload.rawId,
    response: {
      clientDataJSON: payload.response.clientDataJSON,
      authenticatorData: payload.response.authenticatorData,
      signature: payload.response.signature,
      ...(payload.response.userHandle !== undefined ? { userHandle: payload.response.userHandle } : {})
    },
    clientExtensionResults: {},
    type: publicKeyCredentialType
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.EXPECTED_ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: true,
    credential: {
      id: passkey.credential_id,
      publicKey: fromBase64Url(passkey.public_key),
      counter: passkey.counter,
      transports: [...transports]
    }
  })

  if (!verification.verified) {
    throw HttpFailure.make({ status: 401, code: "authentication_failed", message: "Passkey authentication failed" })
  }

  await env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?")
    .bind(verification.authenticationInfo.newCounter, new Date().toISOString(), passkey.credential_id)
    .run()

  const session = await signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  })
  return json({ verified: true }, {
    headers: {
      "set-cookie": makeCookie(SESSION_COOKIE, session, env.EXPECTED_ORIGIN, SESSION_SECONDS)
    }
  })
}

export const logout = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  return noContentWithCookie(clearCookie(SESSION_COOKIE, env.EXPECTED_ORIGIN))
}

const noContentWithCookie = (cookie: string): Response =>
  new Response(null, { status: 204, headers: { "set-cookie": cookie } })

export const listApiKeys = async (request: Request, env: WorkerEnv): Promise<Response> => {
  await requireSession(request, env)
  const result = await env.DB.prepare(
    "SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC"
  ).all()
  const rows = await decode(Schema.Array(ApiKeyRow), result.results)
  return json({
    keys: rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at
    }))
  })
}

export const createApiKey = async (request: Request, env: WorkerEnv): Promise<Response> => {
  assertSameOrigin(request, env)
  await requireSession(request, env)
  const payload = await decode(ApiKeyCreatePayload, await readJson(request))
  const rawKey = `trk_${randomToken(32)}`
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await env.DB.prepare(
    "INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, payload.name.trim().slice(0, 80), rawKey.slice(0, 12), await sha256(rawKey), now).run()

  return json({ id, key: rawKey, prefix: rawKey.slice(0, 12), createdAt: now }, { status: 201 })
}

export const revokeApiKey = async (request: Request, env: WorkerEnv, id: string): Promise<Response> => {
  assertSameOrigin(request, env)
  await requireSession(request, env)
  await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), id)
    .run()
  return noContent()
}

export const authorizeApiKey = async (request: Request, env: WorkerEnv): Promise<string> => {
  const authorization = request.headers.get("authorization") ?? ""
  const rawKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!rawKey.startsWith("trk_")) {
    throw HttpFailure.make({ status: 401, code: "invalid_api_key", message: "A valid ingest API key is required" })
  }

  const row: unknown = await env.DB.prepare(
    "SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL"
  ).bind(await sha256(rawKey)).first()
  const decoded = await decode(Schema.NullOr(Schema.Struct({ id: Schema.String })), row)
  if (!decoded) {
    throw HttpFailure.make({ status: 401, code: "invalid_api_key", message: "API key is invalid or revoked" })
  }
  return decoded.id
}
