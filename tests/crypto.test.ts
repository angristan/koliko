import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { sha256, signValue, verifySignedValue } from "../src/worker/crypto"

const Claims = Schema.Struct({ kind: Schema.Literal("session"), expiresAt: Schema.Number })

describe("authentication crypto", () => {
  it.effect("round trips signed values", () => Effect.gen(function*() {
    const token = yield* Effect.promise(() => signValue("a sufficiently long test secret", {
      kind: "session",
      expiresAt: 1234
    }))
    const unknown = yield* Effect.promise(() => verifySignedValue("a sufficiently long test secret", token))
    const claims = yield* Schema.decodeUnknownEffect(Claims)(unknown)

    assert.strictEqual(claims.kind, "session")
    assert.strictEqual(claims.expiresAt, 1234)
  }))

  it.effect("rejects tampered values", () => Effect.gen(function*() {
    const token = yield* Effect.promise(() => signValue("test secret", { kind: "session", expiresAt: 1234 }))
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`
    const result = yield* Effect.promise(() => verifySignedValue("test secret", tampered))
    assert.isUndefined(result)
  }))

  it.effect("hashes API keys deterministically without storing plaintext", () => Effect.gen(function*() {
    const first = yield* Effect.promise(() => sha256("klk_example"))
    const second = yield* Effect.promise(() => sha256("klk_example"))
    assert.strictEqual(first, second)
    assert.notStrictEqual(first, "klk_example")
  }))
})
