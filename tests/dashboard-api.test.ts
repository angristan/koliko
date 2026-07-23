import { afterEach, describe, expect, vi } from "vitest"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import {
  ApiDecodeError,
  ApiStatusError,
  ApiTransportError,
  getAuthStatus
} from "../src/dashboard/api"
import { retryIdempotentGet } from "../src/dashboard/queries"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("dashboard API client", () => {
  it.effect("decodes successful responses", () => Effect.gen(function*() {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      authenticated: true,
      hasPasskey: true
    }), { status: 200 }))))

    const status = yield* getAuthStatus()

    expect(status).toEqual({ authenticated: true, hasPasskey: true })
  }))

  it.effect("preserves HTTP status failures for retry policy", () => Effect.gen(function*() {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: "unauthorized", message: "Passkey authentication is required" }
    }), { status: 401 }))))

    const error = yield* Effect.flip(getAuthStatus())

    expect(error).toBeInstanceOf(ApiStatusError)
    if (error._tag !== "ApiStatusError") return
    expect(error.status).toBe(401)
    expect(error.message).toBe("Passkey authentication is required")
  }))

  it.effect("classifies malformed successful payloads as decode failures", () => Effect.gen(function*() {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      authenticated: "yes",
      hasPasskey: true
    }), { status: 200 }))))

    const error = yield* Effect.flip(getAuthStatus())

    expect(error).toBeInstanceOf(ApiDecodeError)
  }))

  it("propagates runtime cancellation to fetch", async () => {
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    }))

    const controller = new AbortController()
    const request = Effect.runPromise(getAuthStatus(), { signal: controller.signal })
    const interrupted = expect(request).rejects.toBeDefined()
    controller.abort()

    await interrupted
    expect(requestSignal?.aborted).toBe(true)
  })

  it("retries only bounded idempotent transport and server failures", () => {
    const transport = ApiTransportError.make({
      path: "/api/auth/status",
      message: "offline",
      cause: new Error("offline")
    })
    const server = ApiStatusError.make({ path: "/api/auth/status", status: 503, message: "unavailable" })
    const client = ApiStatusError.make({ path: "/api/auth/status", status: 401, message: "unauthorized" })

    expect(retryIdempotentGet(0, transport)).toBe(true)
    expect(retryIdempotentGet(1, server)).toBe(true)
    expect(retryIdempotentGet(0, client)).toBe(false)
    expect(retryIdempotentGet(2, transport)).toBe(false)
  })
})
