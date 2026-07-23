import { Context, Effect, Schema } from "effect"
import { IngestBatch, type TelemetryEvent } from "../shared/protocol"
import { authorizeApiKey } from "./auth"
import { HttpFailure, json, readJson, type WorkerEnv } from "./http"

class TelemetryStorageError extends Schema.TaggedErrorClass<TelemetryStorageError>()(
  "TelemetryStorageError",
  {
    operation: Schema.String,
    cause: Schema.Defect()
  }
) {}

class InvalidTelemetry extends Schema.TaggedErrorClass<InvalidTelemetry>()("InvalidTelemetry", {
  message: Schema.String
}) {}

class TelemetryRepository extends Context.Service<TelemetryRepository, {
  readonly insert: (
    apiKeyId: string,
    events: ReadonlyArray<TelemetryEvent>
  ) => Effect.Effect<void, TelemetryStorageError>
}>()("TelemetryRepository") {}

const makeRepository = (env: WorkerEnv): TelemetryRepository["Service"] => ({
  insert: (apiKeyId, events) => Effect.tryPromise({
    try: async () => {
      const statements = events.map((event) => env.DB.prepare(
        `INSERT OR IGNORE INTO telemetry_events (
          event_id, schema_version, api_key_id, session_id, runtime_id, sequence,
          occurred_at, event_type, repository, provider, model, thinking_level,
          duration_ms, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, total_tokens, cost_total, tool_name, status, attributes_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        event.id,
        event.schemaVersion,
        apiKeyId,
        event.sessionId,
        event.runtimeId,
        event.sequence,
        event.occurredAt,
        event.type,
        event.repository,
        event.provider ?? null,
        event.model ?? null,
        event.thinkingLevel ?? null,
        event.durationMs ?? null,
        event.inputTokens ?? null,
        event.outputTokens ?? null,
        event.cacheReadTokens ?? null,
        event.cacheWriteTokens ?? null,
        event.totalTokens ?? null,
        event.costTotal ?? null,
        event.toolName ?? null,
        event.status ?? null,
        JSON.stringify(event.attributes ?? {})
      ))

      statements.push(
        env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), apiKeyId)
      )
      await env.DB.batch(statements)
    },
    catch: (cause) => TelemetryStorageError.make({ operation: "insert", cause })
  })
})

const ingest = Effect.fn("Telemetry.ingest")(function*(apiKeyId: string, input: unknown) {
  const batch = yield* Schema.decodeUnknownEffect(IngestBatch)(input).pipe(
    Effect.mapError(() => InvalidTelemetry.make({ message: "Telemetry batch does not match schema version 1" }))
  )

  const repository = yield* TelemetryRepository
  yield* repository.insert(apiKeyId, batch.events)
  return batch.events.length
})

export const ingestTelemetry = Effect.fn("Telemetry.ingestRequest")(function*(
  request: Request,
  env: WorkerEnv
) {
  const apiKeyId = yield* authorizeApiKey(request, env)
  const input = yield* readJson(request)
  const accepted = yield* ingest(apiKeyId, input).pipe(
    Effect.provideService(TelemetryRepository, makeRepository(env)),
    Effect.mapError((error) => error._tag === "InvalidTelemetry"
      ? HttpFailure.make({ status: 400, code: "invalid_telemetry", message: error.message })
      : HttpFailure.make({ status: 500, code: "storage_error", message: "Telemetry could not be stored" }))
  )

  return json({ accepted }, { status: 202 })
})
