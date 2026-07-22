import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it, vi } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { IngestBatch, TelemetryEvent } from "../src/shared/protocol"
import { TelemetryQueue } from "../collectors/pi/queue"

describe("telemetry queue", () => {
  it.effect("persists, sends, and removes acknowledged events", () => Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "traker-test-"))),
    (directory) => Effect.gen(function*() {
      let requestBody: unknown
      vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
        return new Response(JSON.stringify({ accepted: 1 }), { status: 202 })
      })

      const path = join(directory, "spool.jsonl")
      const queue = new TelemetryQueue({ baseUrl: "https://traker.example.com", apiKey: "trk_test" }, path)
      yield* Effect.promise(() => queue.enqueue(TelemetryEvent.make({
        schemaVersion: 1,
        id: "evt_1",
        sessionId: "session_1",
        runtimeId: "runtime_1",
        sequence: 1,
        occurredAt: "2026-07-21T12:00:00.000Z",
        type: "runtime_started",
        repository: "tracker"
      })))
      const sent = yield* Effect.promise(() => queue.flush())
      const batch = yield* Schema.decodeUnknownEffect(IngestBatch)(requestBody)
      const remaining = yield* Effect.promise(() => readFile(path, "utf8"))

      assert.strictEqual(sent, 1)
      assert.strictEqual(batch.events[0].id, "evt_1")
      assert.strictEqual(remaining, "")
      vi.unstubAllGlobals()
    }),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true }))
  ))
})
