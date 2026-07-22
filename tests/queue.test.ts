import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it, vi } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { IngestBatch, TelemetryEvent } from "../src/shared/protocol"
import { TelemetryQueue } from "../collectors/pi/queue"

const event = (id: string, sequence: number) => TelemetryEvent.make({
  schemaVersion: 1,
  id,
  sessionId: "session_1",
  runtimeId: "runtime_1",
  sequence,
  occurredAt: "2026-07-21T12:00:00.000Z",
  type: "runtime_started",
  repository: "traker"
})

const withTemporaryDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "traker-test-"))),
    use,
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true }))
  )

describe("telemetry queue", () => {
  it.effect("persists, sends, and removes acknowledged events", () => withTemporaryDirectory(
    (directory) => Effect.gen(function*() {
      let requestBody: unknown
      vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        return new Response(JSON.stringify({ accepted: 1 }), { status: 202 })
      })

      const path = join(directory, "spool.jsonl")
      const queue = new TelemetryQueue({ baseUrl: "https://traker.example.com", apiKey: "trk_test" }, path)
      yield* Effect.promise(() => queue.enqueue(event("evt_1", 1)))
      const sent = yield* Effect.promise(() => queue.flush())
      const batch = yield* Schema.decodeUnknownEffect(IngestBatch)(requestBody)
      const remaining = yield* Effect.promise(() => readFile(path, "utf8"))

      assert.strictEqual(sent, 1)
      assert.strictEqual(batch.events[0].id, "evt_1")
      assert.strictEqual(remaining, "")
      vi.unstubAllGlobals()
    })
  ))

  it.effect("preserves events appended by another queue during delivery", () => withTemporaryDirectory(
    (directory) => Effect.gen(function*() {
      const path = join(directory, "spool.jsonl")
      const config = { baseUrl: "https://traker.example.com", apiKey: "trk_test" }
      const firstQueue = new TelemetryQueue(config, path)
      const secondQueue = new TelemetryQueue(config, path)
      let releaseResponse: (() => void) | undefined
      let markStarted: (() => void) | undefined
      const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
      const requestStarted = new Promise<void>((resolve) => { markStarted = resolve })

      vi.stubGlobal("fetch", async () => {
        markStarted?.()
        await responseGate
        return new Response(JSON.stringify({ accepted: 1 }), { status: 202 })
      })

      yield* Effect.promise(() => firstQueue.enqueue(event("evt_1", 1)))
      const flush = firstQueue.flush()
      yield* Effect.promise(() => requestStarted)
      yield* Effect.promise(() => secondQueue.enqueue(event("evt_2", 2)))
      releaseResponse?.()
      yield* Effect.promise(() => flush)

      const remaining = yield* Effect.promise(() => readFile(path, "utf8"))
      assert.include(remaining, "evt_2")
      vi.unstubAllGlobals()
    })
  ))

  it.effect("quarantines malformed lines only once when delivery fails", () => withTemporaryDirectory(
    (directory) => Effect.gen(function*() {
      const path = join(directory, "spool.jsonl")
      const queue = new TelemetryQueue({ baseUrl: "https://traker.example.com", apiKey: "trk_test" }, path)
      yield* Effect.promise(() => writeFile(path, `not-json\n${JSON.stringify(event("evt_1", 1))}\n`, "utf8"))
      vi.stubGlobal("fetch", async () => new Response("failure", { status: 503 }))

      yield* Effect.promise(() => queue.flush().catch(() => undefined))
      const firstInvalid = yield* Effect.promise(() => readFile(`${path}.invalid`, "utf8"))
      yield* Effect.promise(() => queue.flush().catch(() => undefined))
      const secondInvalid = yield* Effect.promise(() => readFile(`${path}.invalid`, "utf8"))

      assert.strictEqual(firstInvalid, "not-json\n")
      assert.strictEqual(secondInvalid, firstInvalid)
      vi.unstubAllGlobals()
    })
  ))
})
