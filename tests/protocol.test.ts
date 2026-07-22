import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Schema } from "effect"
import { IngestBatch } from "../src/shared/protocol"

const validEvent = {
  schemaVersion: 1,
  id: "evt_1",
  sessionId: "session_1",
  runtimeId: "runtime_1",
  sequence: 1,
  occurredAt: "2026-07-21T12:00:00.000Z",
  type: "usage",
  repository: "traker",
  model: "claude-sonnet",
  totalTokens: 1200,
  attributes: { source: "assistant" }
}

describe("telemetry protocol", () => {
  it.effect("decodes a valid batch and strips unmodeled content", () => Effect.gen(function*() {
    const batch = yield* Schema.decodeUnknownEffect(IngestBatch)({
      clientName: "traker-pi-extension",
      clientVersion: "0.1.0",
      events: [{ ...validEvent, prompt: "must never cross the boundary" }]
    })

    assert.strictEqual(batch.events.length, 1)
    assert.isFalse("prompt" in batch.events[0])
    assert.strictEqual(batch.events[0].totalTokens, 1200)
  }))

  it.effect("rejects unsupported schema versions", () => Effect.gen(function*() {
    const exit = yield* Effect.exit(Schema.decodeUnknownEffect(IngestBatch)({
      clientName: "traker-pi-extension",
      clientVersion: "0.1.0",
      events: [{ ...validEvent, schemaVersion: 2 }]
    }))

    assert.isTrue(Exit.isFailure(exit))
  }))

  it.effect("rejects invalid timestamps and negative metrics", () => Effect.gen(function*() {
    for (const invalidEvent of [
      { ...validEvent, occurredAt: "0" },
      { ...validEvent, occurredAt: "2026-02-31T00:00:00.000Z" },
      { ...validEvent, sequence: -1 },
      { ...validEvent, totalTokens: -1 },
      { ...validEvent, costTotal: Number.POSITIVE_INFINITY }
    ]) {
      const exit = yield* Effect.exit(Schema.decodeUnknownEffect(IngestBatch)({
        clientName: "traker-pi-extension",
        clientVersion: "0.1.0",
        events: [invalidEvent]
      }))
      assert.isTrue(Exit.isFailure(exit))
    }
  }))

  it.effect("requires a bounded non-empty batch", () => Effect.gen(function*() {
    const empty = yield* Effect.exit(Schema.decodeUnknownEffect(IngestBatch)({
      clientName: "traker-pi-extension",
      clientVersion: "0.1.0",
      events: []
    }))
    const oversized = yield* Effect.exit(Schema.decodeUnknownEffect(IngestBatch)({
      clientName: "traker-pi-extension",
      clientVersion: "0.1.0",
      events: Array.from({ length: 101 }, (_, index) => ({ ...validEvent, id: `evt_${index}` }))
    }))

    assert.isTrue(Exit.isFailure(empty))
    assert.isTrue(Exit.isFailure(oversized))
  }))
})
