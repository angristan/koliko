import type { WorkerEnv } from "./http"

export interface RegistrationWrite {
  readonly mode: "bootstrap" | "session"
  readonly challengeId: string
  readonly challengeExpiresAt: number
  readonly verifiedAt: number
  readonly credentialId: string
  readonly name: string
  readonly publicKey: string
  readonly counter: number
  readonly transports: string
  readonly deviceType: string
  readonly backedUp: boolean
}

export type RegistrationWriteResult = "registered" | "conflict" | "invariant"

export const registerPasskey = async (
  env: WorkerEnv,
  input: RegistrationWrite
): Promise<RegistrationWriteResult> => {
  const attemptId = crypto.randomUUID()
  const now = new Date(input.verifiedAt).toISOString()
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(input.verifiedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO auth_challenges
        (id, purpose, attempt_id, expires_at, consumed_at)
       VALUES (?, 'registration', ?, ?, ?)`
    ).bind(input.challengeId, attemptId, input.challengeExpiresAt, now),
    env.DB.prepare(
      `INSERT INTO passkeys
        (credential_id, name, public_key, counter, transports, device_type, backed_up, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM auth_challenges
         WHERE id = ? AND purpose = 'registration' AND attempt_id = ? AND expires_at > ?
       )
       AND (? = 1 OR NOT EXISTS (SELECT 1 FROM passkeys))`
    ).bind(
      input.credentialId,
      input.name,
      input.publicKey,
      input.counter,
      input.transports,
      input.deviceType,
      input.backedUp ? 1 : 0,
      now,
      input.challengeId,
      attemptId,
      input.verifiedAt,
      input.mode === "session" ? 1 : 0
    )
  ])

  const consumed = results[1]?.meta.changes ?? 0
  const inserted = results[2]?.meta.changes ?? 0
  if (consumed === 1 && inserted === 1) return "registered"
  if (inserted === 0) return "conflict"
  return "invariant"
}

export type PasskeyRemovalResult = "removed" | "unknown" | "final"

export const removePasskey = async (
  env: WorkerEnv,
  credentialId: string
): Promise<PasskeyRemovalResult> => {
  const deletion = await env.DB.prepare(
    `DELETE FROM passkeys
     WHERE credential_id = ?
       AND (SELECT COUNT(*) FROM passkeys) > 1`
  ).bind(credentialId).run()

  if ((deletion.meta.changes ?? 0) === 1) return "removed"

  const exists = await env.DB.prepare(
    "SELECT EXISTS(SELECT 1 FROM passkeys WHERE credential_id = ?) AS found"
  ).bind(credentialId).first<number>("found")
  return exists === 1 ? "final" : "unknown"
}

export interface AuthenticationWrite {
  readonly challengeId: string
  readonly challengeExpiresAt: number
  readonly verifiedAt: number
  readonly credentialId: string
  readonly previousCounter: number
  readonly nextCounter: number
}

export type AuthenticationWriteResult = "authenticated" | "stale" | "invariant"

export const completeAuthentication = async (
  env: WorkerEnv,
  input: AuthenticationWrite
): Promise<AuthenticationWriteResult> => {
  const attemptId = crypto.randomUUID()
  const now = new Date(input.verifiedAt).toISOString()
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(input.verifiedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO auth_challenges
        (id, purpose, attempt_id, expires_at, consumed_at)
       VALUES (?, 'authentication', ?, ?, ?)`
    ).bind(input.challengeId, attemptId, input.challengeExpiresAt, now),
    env.DB.prepare(
      `UPDATE passkeys SET counter = ?, last_used_at = ?
       WHERE credential_id = ? AND counter = ?
       AND EXISTS (
         SELECT 1 FROM auth_challenges
         WHERE id = ? AND purpose = 'authentication' AND attempt_id = ? AND expires_at > ?
       )`
    ).bind(
      input.nextCounter,
      now,
      input.credentialId,
      input.previousCounter,
      input.challengeId,
      attemptId,
      input.verifiedAt
    )
  ])

  const consumed = results[1]?.meta.changes ?? 0
  const updated = results[2]?.meta.changes ?? 0
  if (consumed === 1 && updated === 1) return "authenticated"
  if (updated === 0) return "stale"
  return "invariant"
}
