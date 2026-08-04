import { env } from "cloudflare:workers"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import worker from "../../src/worker/index"
import { completeAuthentication, registerPasskey } from "../../src/worker/auth-storage"
import { sha256, signValue } from "../../src/worker/crypto"

const fetchWorker = async (request: Request): Promise<Response> => {
  const context = createExecutionContext()
  const response = await worker.fetch(request, env, context)
  await waitOnExecutionContext(context)
  return response
}

const insertApiKey = async (id = "key_1", rawKey = "klk_test_key"): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, "Test collector", rawKey.slice(0, 12), await sha256(rawKey), "2026-07-21T00:00:00.000Z").run()
}

const sessionCookie = async (): Promise<string> => {
  const token = await signValue(env.SESSION_SECRET, {
    kind: "session",
    expiresAt: Date.now() + 60_000
  })
  return `koliko_session=${encodeURIComponent(token)}`
}

const insertPasskey = async (
  id: string,
  name: string,
  createdAt: string,
  backedUp = false,
  lastUsedAt: string | null = null
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO passkeys
      (credential_id, name, public_key, counter, transports, device_type, backed_up, created_at, last_used_at)
     VALUES (?, ?, 'public-key', 0, '[]', 'singleDevice', ?, ?, ?)`
  ).bind(id, name, backedUp ? 1 : 0, createdAt, lastUsedAt).run()
}

describe("Worker runtime", () => {
  it("does not serve static content when invoked directly", async () => {
    const response = await fetchWorker(new Request("https://example.test/"))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Not found")
  })

  it("serves authentication status through Workerd", async () => {
    const response = await fetchWorker(new Request("https://example.test/api/auth/status"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: false, hasPasskey: false })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("requires the named registration verify envelope", async () => {
    const optionsResponse = await fetchWorker(new Request("https://example.test/api/auth/register/options", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        "x-bootstrap-token": env.BOOTSTRAP_TOKEN
      }
    }))
    expect(optionsResponse.status).toBe(200)
    const setCookie = optionsResponse.headers.get("set-cookie")
    expect(setCookie).not.toBeNull()
    if (setCookie === null) return
    const cookie = setCookie.split(";", 1)[0]
    const credential = {
      id: "credential_1",
      rawId: "credential_1",
      response: {
        clientDataJSON: "client-data",
        attestationObject: "attestation"
      },
      type: "public-key"
    }
    const headers = {
      cookie,
      origin: "https://example.test",
      "content-type": "application/json",
      "x-bootstrap-token": env.BOOTSTRAP_TOKEN
    }

    const unnamedResponse = await fetchWorker(new Request("https://example.test/api/auth/register/verify", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "", credential })
    }))
    expect(unnamedResponse.status).toBe(400)
    expect(await unnamedResponse.json()).toEqual({
      error: { code: "invalid_request", message: "Request payload is invalid" }
    })

    const legacyResponse = await fetchWorker(new Request("https://example.test/api/auth/register/verify", {
      method: "POST",
      headers,
      body: JSON.stringify(credential)
    }))
    expect(legacyResponse.status).toBe(400)
    expect(await legacyResponse.json()).toEqual({
      error: { code: "invalid_request", message: "Request payload is invalid" }
    })
  })

  it("lists only safe named passkey metadata for an authenticated session", async () => {
    await insertPasskey(
      "credential_1",
      "MacBook Touch ID",
      "2026-07-20T00:00:00.000Z",
      true,
      "2026-07-22T00:00:00.000Z"
    )
    await insertPasskey("credential_2", "Security key", "2026-07-21T00:00:00.000Z")

    const response = await fetchWorker(new Request("https://example.test/api/auth/passkeys", {
      headers: { cookie: await sessionCookie() }
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      passkeys: [
        {
          id: "credential_1",
          name: "MacBook Touch ID",
          deviceType: "singleDevice",
          backedUp: true,
          createdAt: "2026-07-20T00:00:00.000Z",
          lastUsedAt: "2026-07-22T00:00:00.000Z"
        },
        {
          id: "credential_2",
          name: "Security key",
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: "2026-07-21T00:00:00.000Z",
          lastUsedAt: null
        }
      ]
    })
  })

  it("requires authentication to manage passkeys", async () => {
    await insertPasskey("credential_1", "MacBook", "2026-07-20T00:00:00.000Z")
    await insertPasskey("credential_2", "Security key", "2026-07-21T00:00:00.000Z")

    const listResponse = await fetchWorker(new Request("https://example.test/api/auth/passkeys"))
    expect(listResponse.status).toBe(401)
    expect(await listResponse.json()).toEqual({
      error: { code: "unauthorized", message: "Passkey authentication is required" }
    })

    const deleteResponse = await fetchWorker(new Request(
      "https://example.test/api/auth/passkeys/credential_1",
      { method: "DELETE", headers: { origin: "https://example.test" } }
    ))
    expect(deleteResponse.status).toBe(401)
    expect(await deleteResponse.json()).toEqual({
      error: { code: "unauthorized", message: "Passkey authentication is required" }
    })
  })

  it("removes a passkey with same-origin authenticated confirmation", async () => {
    await insertPasskey("credential_1", "MacBook", "2026-07-20T00:00:00.000Z")
    await insertPasskey("credential_2", "Security key", "2026-07-21T00:00:00.000Z")

    const response = await fetchWorker(new Request("https://example.test/api/auth/passkeys/credential_1", {
      method: "DELETE",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://example.test"
      }
    }))

    expect(response.status).toBe(204)
    const remaining = await env.DB.prepare("SELECT credential_id, name FROM passkeys").all()
    expect(remaining.results).toEqual([{ credential_id: "credential_2", name: "Security key" }])
  })

  it("returns typed errors for unknown and final passkeys", async () => {
    await insertPasskey("credential_1", "Only passkey", "2026-07-20T00:00:00.000Z")
    const headers = {
      cookie: await sessionCookie(),
      origin: "https://example.test"
    }

    const unknownResponse = await fetchWorker(new Request("https://example.test/api/auth/passkeys/unknown", {
      method: "DELETE",
      headers
    }))
    expect(unknownResponse.status).toBe(404)
    expect(await unknownResponse.json()).toEqual({
      error: { code: "passkey_not_found", message: "Passkey was not found" }
    })

    const finalResponse = await fetchWorker(new Request("https://example.test/api/auth/passkeys/credential_1", {
      method: "DELETE",
      headers
    }))
    expect(finalResponse.status).toBe(409)
    expect(await finalResponse.json()).toEqual({
      error: { code: "last_passkey", message: "The final passkey cannot be removed" }
    })
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM passkeys").first<number>("count")
    expect(count).toBe(1)
  })

  it("atomically keeps one passkey during concurrent removals", async () => {
    await insertPasskey("credential_1", "MacBook", "2026-07-20T00:00:00.000Z")
    await insertPasskey("credential_2", "Security key", "2026-07-21T00:00:00.000Z")
    const headers = {
      cookie: await sessionCookie(),
      origin: "https://example.test"
    }

    const responses = await Promise.all([
      fetchWorker(new Request("https://example.test/api/auth/passkeys/credential_1", { method: "DELETE", headers })),
      fetchWorker(new Request("https://example.test/api/auth/passkeys/credential_2", { method: "DELETE", headers }))
    ])

    expect(responses.map((response) => response.status).toSorted()).toEqual([204, 409])
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM passkeys").first<number>("count")
    expect(count).toBe(1)
  })

  it("requires same-origin deletion requests", async () => {
    await insertPasskey("credential_1", "MacBook", "2026-07-20T00:00:00.000Z")
    await insertPasskey("credential_2", "Security key", "2026-07-21T00:00:00.000Z")

    const response = await fetchWorker(new Request("https://example.test/api/auth/passkeys/credential_1", {
      method: "DELETE",
      headers: { cookie: await sessionCookie() }
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: "invalid_origin", message: "Request origin is not allowed" }
    })
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM passkeys").first<number>("count")
    expect(count).toBe(2)
  })

  it("validates and persists telemetry through D1", async () => {
    await insertApiKey()
    const response = await fetchWorker(new Request("https://example.test/api/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer klk_test_key",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientName: "koliko-pi-extension",
        clientVersion: "0.1.0",
        events: [{
          schemaVersion: 1,
          id: "evt_1",
          sessionId: "session_1",
          runtimeId: "runtime_1",
          sequence: 1,
          occurredAt: "2026-07-21T12:00:00.000Z",
          type: "usage",
          repository: "koliko",
          totalTokens: 42,
          attributes: { source: "assistant" }
        }]
      })
    }))

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: 1 })
    const stored = await env.DB.prepare("SELECT event_id, total_tokens FROM telemetry_events").first()
    expect(stored).toEqual({ event_id: "evt_1", total_tokens: 42 })
  })

  it("aggregates detailed daily dimensions for charting", async () => {
    await insertApiKey()
    const baseEvent = {
      schemaVersion: 1,
      sessionId: "session_charts",
      runtimeId: "runtime_charts",
      occurredAt: "2026-07-21T12:00:00.000Z",
      repository: "koliko"
    }
    const events = [
      {
        ...baseEvent,
        id: "chart_usage",
        sequence: 1,
        type: "usage",
        provider: "provider",
        model: "model",
        thinkingLevel: "high",
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        totalTokens: 180,
        costTotal: 0.25,
        attributes: { source: "assistant" }
      },
      { ...baseEvent, id: "chart_run", sequence: 2, type: "agent_run", durationMs: 120_000, status: "completed" },
      { ...baseEvent, id: "chart_tool_ok", sequence: 3, type: "tool_execution", toolName: "read", durationMs: 250, status: "completed" },
      { ...baseEvent, id: "chart_tool_error", sequence: 4, type: "tool_execution", toolName: "bash", durationMs: 500, status: "error" },
      { ...baseEvent, id: "chart_compaction", sequence: 5, type: "compaction", status: "completed", attributes: { reason: "manual", tokensBefore: 50_000 } },
      { ...baseEvent, id: "chart_goal", sequence: 6, type: "goal", status: "completed" },
      { ...baseEvent, id: "chart_subagent", sequence: 7, type: "subagent", status: "started", attributes: { action: "spawn" } }
    ]

    const ingestResponse = await fetchWorker(new Request("https://example.test/api/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer klk_test_key",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientName: "koliko-pi-extension",
        clientVersion: "0.1.0",
        events
      })
    }))
    expect(ingestResponse.status).toBe(202)

    const response = await fetchWorker(new Request(
      "https://example.test/api/dashboard?from=2026-07-21&to=2026-07-21",
      { headers: { cookie: await sessionCookie() } }
    ))
    expect(response.status).toBe(200)
    const result = await response.json() as {
      from: string
      to: string
      daily: ReadonlyArray<Record<string, number | string>>
    }
    expect({ from: result.from, to: result.to }).toEqual({ from: "2026-07-21", to: "2026-07-21" })
    expect(result.daily).toEqual([{
      date: "2026-07-21",
      sessions: 1,
      turns: 1,
      trackedMs: 120_000,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      tokens: 180,
      cost: 0.25,
      toolCalls: 2,
      toolErrors: 1,
      compactions: 1,
      goals: 1,
      subagents: 1
    }])
  })

  it("rejects invalid telemetry before persistence", async () => {
    await insertApiKey()
    const response = await fetchWorker(new Request("https://example.test/api/v1/events", {
      method: "POST",
      headers: {
        authorization: "Bearer klk_test_key",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        clientName: "koliko-pi-extension",
        clientVersion: "0.1.0",
        events: [{
          schemaVersion: 1,
          id: "evt_invalid",
          sessionId: "session_1",
          runtimeId: "runtime_1",
          sequence: 1,
          occurredAt: "0",
          type: "usage",
          repository: "koliko",
          totalTokens: -1
        }]
      })
    }))

    expect(response.status).toBe(400)
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM telemetry_events").first<number>("count")
    expect(count).toBe(0)
  })

  it("allows only one concurrent bootstrap registration", async () => {
    const verifiedAt = Date.now()
    const input = {
      mode: "bootstrap" as const,
      challengeExpiresAt: verifiedAt + 60_000,
      verifiedAt,
      name: "Bootstrap passkey",
      publicKey: "public-key",
      counter: 0,
      transports: "[]",
      deviceType: "singleDevice",
      backedUp: false
    }
    const results = await Promise.all([
      registerPasskey(env, { ...input, challengeId: "challenge_1", credentialId: "credential_1" }),
      registerPasskey(env, { ...input, challengeId: "challenge_2", credentialId: "credential_2" })
    ])

    expect(results.toSorted()).toEqual(["conflict", "registered"])
    const stored = await env.DB.prepare("SELECT name FROM passkeys").first()
    expect(stored).toEqual({ name: "Bootstrap passkey" })
  })

  it("rejects concurrent reuse of an authentication challenge", async () => {
    await env.DB.prepare(
      `INSERT INTO passkeys
        (credential_id, public_key, counter, transports, device_type, backed_up, created_at)
       VALUES ('credential_1', 'public-key', 0, '[]', 'singleDevice', 0, '2026-07-21T00:00:00.000Z')`
    ).run()
    const verifiedAt = Date.now()
    const input = {
      challengeId: "challenge_1",
      challengeExpiresAt: verifiedAt + 60_000,
      verifiedAt,
      credentialId: "credential_1",
      previousCounter: 0,
      nextCounter: 1
    }
    const results = await Promise.all([
      completeAuthentication(env, input),
      completeAuthentication(env, input)
    ])

    expect(results.toSorted()).toEqual(["authenticated", "stale"])
    const passkey = await env.DB.prepare(
      "SELECT counter FROM passkeys WHERE credential_id = 'credential_1'"
    ).first<{ counter: number }>()
    expect(passkey?.counter).toBe(1)
  })

  it("reports the latest model and latest 500 session events", async () => {
    await insertApiKey()
    await env.DB.prepare(
      `WITH RECURSIVE event_sequence(value) AS (
         SELECT 1
         UNION ALL
         SELECT value + 1 FROM event_sequence WHERE value < 501
       )
       INSERT INTO telemetry_events (
         event_id, schema_version, api_key_id, session_id, runtime_id, sequence,
         occurred_at, event_type, repository, provider, model, attributes_json
       )
       SELECT
         'evt_' || value, 1, 'key_1', 'session_1', 'runtime_1', value,
         '2026-07-21T12:00:00.' || printf('%03d', value) || 'Z',
         'model_selected', 'koliko', 'provider',
         CASE WHEN value = 501 THEN 'a-latest' WHEN value = 500 THEN 'z-older' ELSE NULL END,
         '{}'
       FROM event_sequence`
    ).run()
    const cookie = await sessionCookie()

    const dashboardResponse = await fetchWorker(new Request(
      "https://example.test/api/dashboard?from=2026-07-21&to=2026-07-21",
      { headers: { cookie } }
    ))
    expect(dashboardResponse.status).toBe(200)
    const dashboard = await dashboardResponse.json() as { sessions: Array<{ model: string }> }
    expect(dashboard.sessions[0]?.model).toBe("provider/a-latest")

    const sessionResponse = await fetchWorker(new Request(
      "https://example.test/api/sessions/session_1",
      { headers: { cookie } }
    ))
    expect(sessionResponse.status).toBe(200)
    const session = await sessionResponse.json() as {
      truncated: boolean
      events: Array<{ id: string }>
    }
    expect(session.truncated).toBe(true)
    expect(session.events).toHaveLength(500)
    expect(session.events[0]?.id).toBe("evt_2")
    expect(session.events.at(-1)?.id).toBe("evt_501")
  })
})
