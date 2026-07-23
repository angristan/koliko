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
import { completeAuthentication, registerPasskey } from "./auth-storage"
import { fromBase64Url, randomToken, safeSecretEqual, sha256, signValue, toBase64Url, verifySignedValue } from "./crypto"
import {
  clearCookie,
  getCookie,
  HttpFailure,
  json,
  makeCookie,
  noContent,
  type WorkerEnv
} from "./http"

const SESSION_COOKIE = "koliko_session"
const CHALLENGE_COOKIE = "koliko_challenge"
const SESSION_SECONDS = 60 * 60 * 24 * 7
const CHALLENGE_SECONDS = 60 * 5
const publicKeyCredentialType: "public-key" = "public-key"

const ChallengePurpose = Schema.Literals(["registration", "authentication"])
type ChallengePurposeValue = typeof ChallengePurpose.Type

const ChallengeClaims = Schema.Struct({
  kind: Schema.Literal("challenge"),
  id: Schema.String,
  purpose: ChallengePurpose,
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

const AuthOperationCategory = Schema.Literals(["storage", "crypto", "authenticator"])
type AuthOperationCategory = typeof AuthOperationCategory.Type

class AuthOperationError extends Schema.TaggedErrorClass<AuthOperationError>()("AuthOperationError", {
  category: AuthOperationCategory,
  operation: Schema.String,
  cause: Schema.Defect()
}) {}

const internalFailure = (): HttpFailure => HttpFailure.make({
  status: 500,
  code: "internal_error",
  message: "An unexpected error occurred"
})

const mapOperationalError = <A>(effect: Effect.Effect<A, AuthOperationError>): Effect.Effect<A, HttpFailure> =>
  effect.pipe(
    Effect.tapError((error) => Effect.sync(() => console.error("Authentication dependency failed", {
      category: error.category,
      operation: error.operation
    }))),
    Effect.mapError(internalFailure)
  )

const tryOperation = <A>(
  category: AuthOperationCategory,
  operation: string,
  run: () => Promise<A>
): Effect.Effect<A, HttpFailure> => mapOperationalError(Effect.tryPromise({
  try: run,
  catch: (cause) => AuthOperationError.make({ category, operation, cause })
}))

const tryStorage = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, HttpFailure> =>
  tryOperation("storage", operation, run)

const tryCrypto = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, HttpFailure> =>
  tryOperation("crypto", operation, run)

const tryCryptoSync = <A>(operation: string, run: () => A): Effect.Effect<A, HttpFailure> =>
  mapOperationalError(Effect.try({
    try: run,
    catch: (cause) => AuthOperationError.make({ category: "crypto", operation, cause })
  }))

const tryAuthenticator = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, HttpFailure> =>
  tryOperation("authenticator", operation, run)

const decodeRequest = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Effect.Effect<S["Type"], HttpFailure> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => HttpFailure.make({
      status: 400,
      code: "invalid_request",
      message: "Request payload is invalid"
    }))
  )

const decodeStored = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Effect.Effect<S["Type"], HttpFailure> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => HttpFailure.make({
      status: 500,
      code: "invalid_database_result",
      message: "Stored authentication data is invalid"
    }))
  )

const requireSameOrigin = (request: Request, env: WorkerEnv): Effect.Effect<void, HttpFailure> =>
  request.headers.get("origin") === env.EXPECTED_ORIGIN
    ? Effect.succeed(undefined)
    : Effect.fail(HttpFailure.make({
      status: 403,
      code: "invalid_origin",
      message: "Request origin is not allowed"
    }))

const readRequestJson = (request: Request): Effect.Effect<unknown, HttpFailure> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: () => HttpFailure.make({
      status: 400,
      code: "invalid_json",
      message: "Request body must be valid JSON"
    })
  })

const countPasskeys = Effect.fn("Auth.countPasskeys")(function*(env: WorkerEnv) {
  const row: unknown = yield* tryStorage(
    "count passkeys",
    () => env.DB.prepare("SELECT COUNT(*) AS count FROM passkeys").first()
  )
  const decoded = yield* decodeStored(Schema.NullOr(Schema.Struct({ count: Schema.Number })), row)
  return decoded?.count ?? 0
})

const hasValidSession = Effect.fn("Auth.hasValidSession")(function*(request: Request, env: WorkerEnv) {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return false

  const value = yield* tryCrypto(
    "verify session signature",
    () => verifySignedValue(env.SESSION_SECRET, token)
  )
  const claims = yield* Schema.decodeUnknownEffect(SessionClaims)(value).pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (decoded) => decoded
    })
  )
  return claims !== undefined && claims.expiresAt > Date.now()
})

export const requireSession = Effect.fn("Auth.requireSession")(function*(request: Request, env: WorkerEnv) {
  if (!(yield* hasValidSession(request, env))) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "unauthorized",
      message: "Passkey authentication is required"
    }))
  }
})

const requireBootstrapOrSession = Effect.fn("Auth.requireBootstrapOrSession")(function*(
  request: Request,
  env: WorkerEnv
) {
  if ((yield* countPasskeys(env)) > 0) {
    yield* requireSession(request, env)
    return "session" as const
  }

  const token = request.headers.get("x-bootstrap-token") ?? ""
  const tokenMatches = token.length > 0 && (yield* tryCrypto(
    "compare bootstrap token",
    () => safeSecretEqual(token, env.BOOTSTRAP_TOKEN)
  ))
  if (!tokenMatches) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "invalid_bootstrap_token",
      message: "Bootstrap token is invalid"
    }))
  }
  return "bootstrap" as const
})

const makeChallenge = Effect.fn("Auth.makeChallenge")(function*(
  purpose: ChallengePurposeValue,
  challenge: string
) {
  const id = yield* tryCryptoSync("generate challenge id", () => crypto.randomUUID())
  return {
    kind: "challenge" as const,
    id,
    purpose,
    challenge,
    expiresAt: Date.now() + CHALLENGE_SECONDS * 1000
  }
})

const challengeCookie = Effect.fn("Auth.challengeCookie")(function*(
  env: WorkerEnv,
  challenge: typeof ChallengeClaims.Type
) {
  const signedChallenge = yield* tryCrypto(
    "sign challenge",
    () => signValue(env.SESSION_SECRET, challenge)
  )
  return makeCookie(
    CHALLENGE_COOKIE,
    signedChallenge,
    env.EXPECTED_ORIGIN,
    CHALLENGE_SECONDS
  )
})

const invalidChallenge = (): HttpFailure => HttpFailure.make({
  status: 400,
  code: "invalid_challenge",
  message: "Passkey challenge expired or is invalid"
})

const readChallenge = Effect.fn("Auth.readChallenge")(function*(
  request: Request,
  env: WorkerEnv,
  purpose: ChallengePurposeValue
) {
  const token = getCookie(request, CHALLENGE_COOKIE)
  const value = token
    ? yield* tryCrypto("verify challenge signature", () => verifySignedValue(env.SESSION_SECRET, token))
    : undefined
  const claims = yield* Schema.decodeUnknownEffect(ChallengeClaims)(value).pipe(
    Effect.mapError(invalidChallenge)
  )

  if (claims.purpose !== purpose || claims.expiresAt <= Date.now()) {
    return yield* Effect.fail(invalidChallenge())
  }
  return claims
})

const verifiedResponse = (env: WorkerEnv, session: string): Response => {
  const headers = new Headers()
  headers.append("set-cookie", makeCookie(SESSION_COOKIE, session, env.EXPECTED_ORIGIN, SESSION_SECONDS))
  headers.append("set-cookie", clearCookie(CHALLENGE_COOKIE, env.EXPECTED_ORIGIN))
  return json({ verified: true }, { headers })
}

const listPasskeyRows = Effect.fn("Auth.listPasskeys")(function*(env: WorkerEnv) {
  const result = yield* tryStorage(
    "list passkeys",
    () => env.DB.prepare("SELECT * FROM passkeys ORDER BY created_at").all()
  )
  return yield* decodeStored(Schema.Array(PasskeyRow), result.results)
})

const parseTransports = Effect.fn("Auth.parseTransports")(function*(encoded: string) {
  const value: unknown = yield* Effect.try({
    try: () => JSON.parse(encoded) as unknown,
    catch: () => HttpFailure.make({
      status: 500,
      code: "invalid_passkey",
      message: "Stored passkey data is invalid"
    })
  })
  return yield* decodeStored(Transports, value)
})

export const authStatus = Effect.fn("Auth.status")(function*(request: Request, env: WorkerEnv) {
  const authenticated = yield* hasValidSession(request, env)
  const hasPasskey = (yield* countPasskeys(env)) > 0
  return json({ authenticated, hasPasskey })
})

export const registrationOptions = Effect.fn("Auth.registrationOptions")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  yield* requireBootstrapOrSession(request, env)

  const passkeys = yield* listPasskeyRows(env)
  const excludeCredentials = yield* Effect.forEach(passkeys, (passkey) =>
    parseTransports(passkey.transports).pipe(Effect.map((transports) => ({
      id: passkey.credential_id,
      transports: [...transports]
    }))))
  const options = yield* tryAuthenticator("generate registration options", () =>
    generateRegistrationOptions({
      rpName: env.RP_NAME,
      rpID: env.RP_ID,
      userName: "owner",
      userDisplayName: "Koliko owner",
      userID: new TextEncoder().encode("koliko-owner"),
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      }
    }))

  const challenge = yield* makeChallenge("registration", options.challenge)
  const cookie = yield* challengeCookie(env, challenge)
  return json(options, { headers: { "set-cookie": cookie } })
})

export const verifyRegistration = Effect.fn("Auth.verifyRegistration")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  const registrationMode = yield* requireBootstrapOrSession(request, env)
  const challenge = yield* readChallenge(request, env, "registration")
  const input = yield* readRequestJson(request)
  const payload = yield* decodeRequest(RegistrationCredentialPayload, input)

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

  const verification = yield* tryAuthenticator("verify registration response", () =>
    verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.EXPECTED_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true
    }))

  if (!verification.verified) {
    return yield* Effect.fail(HttpFailure.make({
      status: 400,
      code: "registration_failed",
      message: "Passkey registration could not be verified"
    }))
  }

  const verifiedAt = Date.now()
  const credential = verification.registrationInfo.credential
  const publicKey = yield* tryCryptoSync(
    "encode passkey public key",
    () => toBase64Url(credential.publicKey)
  )
  const writeResult = yield* tryStorage("register passkey", () => registerPasskey(env, {
    mode: registrationMode,
    challengeId: challenge.id,
    challengeExpiresAt: challenge.expiresAt,
    verifiedAt,
    credentialId: credential.id,
    publicKey,
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp
  }))
  if (writeResult === "conflict") {
    return yield* Effect.fail(HttpFailure.make({
      status: 409,
      code: "registration_conflict",
      message: "Passkey registration must be restarted"
    }))
  }
  if (writeResult === "invariant") {
    return yield* Effect.fail(HttpFailure.make({
      status: 500,
      code: "registration_invariant",
      message: "Passkey registration could not be completed"
    }))
  }

  const session = yield* tryCrypto("sign session", () => signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  }))
  return verifiedResponse(env, session)
})

export const authenticationOptions = Effect.fn("Auth.authenticationOptions")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  const passkeys = yield* listPasskeyRows(env)
  if (passkeys.length === 0) {
    return yield* Effect.fail(HttpFailure.make({
      status: 409,
      code: "setup_required",
      message: "Register the first passkey before signing in"
    }))
  }

  const allowCredentials = yield* Effect.forEach(passkeys, (passkey) =>
    parseTransports(passkey.transports).pipe(Effect.map((transports) => ({
      id: passkey.credential_id,
      transports: [...transports]
    }))))
  const options = yield* tryAuthenticator("generate authentication options", () =>
    generateAuthenticationOptions({
      rpID: env.RP_ID,
      userVerification: "required",
      allowCredentials
    }))

  const challenge = yield* makeChallenge("authentication", options.challenge)
  const cookie = yield* challengeCookie(env, challenge)
  return json(options, { headers: { "set-cookie": cookie } })
})

export const verifyAuthentication = Effect.fn("Auth.verifyAuthentication")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  const challenge = yield* readChallenge(request, env, "authentication")
  const input = yield* readRequestJson(request)
  const payload = yield* decodeRequest(AuthenticationCredentialPayload, input)
  const raw: unknown = yield* tryStorage(
    "find passkey",
    () => env.DB.prepare("SELECT * FROM passkeys WHERE credential_id = ?").bind(payload.id).first()
  )
  const passkey = yield* decodeStored(Schema.NullOr(PasskeyRow), raw)
  if (!passkey) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "unknown_passkey",
      message: "Passkey is not registered"
    }))
  }
  const transports = yield* parseTransports(passkey.transports)

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

  const publicKey = yield* tryCryptoSync(
    "decode passkey public key",
    () => fromBase64Url(passkey.public_key)
  )
  const verification = yield* tryAuthenticator("verify authentication response", () =>
    verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.EXPECTED_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey,
        counter: passkey.counter,
        transports: [...transports]
      }
    }))

  if (!verification.verified) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "authentication_failed",
      message: "Passkey authentication failed"
    }))
  }

  const verifiedAt = Date.now()
  const writeResult = yield* tryStorage("complete authentication", () => completeAuthentication(env, {
    challengeId: challenge.id,
    challengeExpiresAt: challenge.expiresAt,
    verifiedAt,
    credentialId: passkey.credential_id,
    previousCounter: passkey.counter,
    nextCounter: verification.authenticationInfo.newCounter
  }))
  if (writeResult === "stale") {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "stale_authentication",
      message: "Passkey authentication must be restarted"
    }))
  }
  if (writeResult === "invariant") {
    return yield* Effect.fail(HttpFailure.make({
      status: 500,
      code: "authentication_invariant",
      message: "Passkey authentication could not be completed"
    }))
  }

  const session = yield* tryCrypto("sign session", () => signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + SESSION_SECONDS * 1000
  }))
  return verifiedResponse(env, session)
})

const noContentWithCookie = (cookie: string): Response =>
  new Response(null, { status: 204, headers: { "set-cookie": cookie } })

export const logout = Effect.fn("Auth.logout")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  return noContentWithCookie(clearCookie(SESSION_COOKIE, env.EXPECTED_ORIGIN))
})

export const listApiKeys = Effect.fn("Auth.listApiKeys")(function*(request: Request, env: WorkerEnv) {
  yield* requireSession(request, env)
  const result = yield* tryStorage(
    "list API keys",
    () => env.DB.prepare(
      "SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC"
    ).all()
  )
  const rows = yield* decodeStored(Schema.Array(ApiKeyRow), result.results)
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
})

export const createApiKey = Effect.fn("Auth.createApiKey")(function*(request: Request, env: WorkerEnv) {
  yield* requireSameOrigin(request, env)
  yield* requireSession(request, env)
  const input = yield* readRequestJson(request)
  const payload = yield* decodeRequest(ApiKeyCreatePayload, input)
  const token = yield* tryCryptoSync("generate API key", () => randomToken(32))
  const rawKey = `klk_${token}`
  const now = new Date().toISOString()
  const id = yield* tryCryptoSync("generate API key id", () => crypto.randomUUID())
  const keyHash = yield* tryCrypto("hash API key", () => sha256(rawKey))

  yield* tryStorage("create API key", () => env.DB.prepare(
    "INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, payload.name, rawKey.slice(0, 12), keyHash, now).run())

  return json({ id, key: rawKey, prefix: rawKey.slice(0, 12), createdAt: now }, { status: 201 })
})

export const revokeApiKey = Effect.fn("Auth.revokeApiKey")(function*(request: Request, env: WorkerEnv, id: string) {
  yield* requireSameOrigin(request, env)
  yield* requireSession(request, env)
  yield* tryStorage("revoke API key", () =>
    env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), id)
      .run())
  return noContent()
})

export const authorizeApiKey = Effect.fn("Auth.authorizeApiKey")(function*(request: Request, env: WorkerEnv) {
  const authorization = request.headers.get("authorization") ?? ""
  const rawKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  if (!rawKey.startsWith("klk_")) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "invalid_api_key",
      message: "A valid ingest API key is required"
    }))
  }

  const keyHash = yield* tryCrypto("hash API key", () => sha256(rawKey))
  const row: unknown = yield* tryStorage(
    "authorize API key",
    () => env.DB.prepare(
      "SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL"
    ).bind(keyHash).first()
  )
  const decoded = yield* decodeStored(Schema.NullOr(Schema.Struct({ id: Schema.String })), row)
  if (!decoded) {
    return yield* Effect.fail(HttpFailure.make({
      status: 401,
      code: "invalid_api_key",
      message: "API key is invalid or revoked"
    }))
  }
  return decoded.id
})
