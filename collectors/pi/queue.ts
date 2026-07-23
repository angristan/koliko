import { appendFile, chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import { dirname } from "node:path"
import { Effect, Schema } from "effect"
import { IngestAccepted, IngestBatch, TelemetryEvent } from "../../src/shared/protocol"
import type { LoadedConfig } from "./config"

const CLIENT_VERSION = "0.1.0"
const LOCK_RETRY_MS = 10
const STALE_LOCK_MS = 60_000

class SpoolOperationError extends Schema.TaggedErrorClass<SpoolOperationError>()("SpoolOperationError", {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Defect()
}) {}

class DeliveryError extends Schema.TaggedErrorClass<DeliveryError>()("DeliveryError", {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const spoolFailure = (operation: string, path: string, cause: unknown): SpoolOperationError =>
  SpoolOperationError.make({ operation, path, message: errorMessage(cause), cause })

const fileOperation = <A>(operation: string, path: string, run: () => Promise<A>): Effect.Effect<A, SpoolOperationError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => spoolFailure(operation, path, cause)
  })

const optionalOnCode = <A>(
  effect: Effect.Effect<A, SpoolOperationError>,
  code: string
): Effect.Effect<A | undefined, SpoolOperationError> => effect.pipe(
  Effect.catchIf(
    (error) => errorCode(error.cause) === code,
    () => Effect.succeed(undefined)
  )
)

const removeStaleLock = Effect.fn("PiCollector.removeStaleLock")(function*(path: string) {
  const details = yield* optionalOnCode(
    fileOperation("inspect lock", path, () => stat(path)),
    "ENOENT"
  )
  if (!details || Date.now() - details.mtimeMs <= STALE_LOCK_MS) return

  yield* optionalOnCode(
    fileOperation("remove stale lock", path, () => unlink(path)),
    "ENOENT"
  )
})

const acquireFileLock = Effect.fn("PiCollector.acquireFileLock")(function*(path: string) {
  const lockPath = `${path}.lock`
  yield* fileOperation("create spool directory", dirname(path), () => mkdir(dirname(path), { recursive: true, mode: 0o700 }))

  while (true) {
    const handle = yield* optionalOnCode(
      fileOperation("acquire lock", lockPath, () => open(lockPath, "wx", 0o600)),
      "EEXIST"
    )
    if (handle) return { handle, lockPath }

    yield* removeStaleLock(lockPath)
    yield* Effect.sleep(LOCK_RETRY_MS)
  }
})

const releaseFileLock = Effect.fn("PiCollector.releaseFileLock")(function*(resource: {
  readonly handle: FileHandle
  readonly lockPath: string
}) {
  yield* fileOperation("close lock", resource.lockPath, () => resource.handle.close())
  yield* optionalOnCode(
    fileOperation("remove lock", resource.lockPath, () => unlink(resource.lockPath)),
    "ENOENT"
  )
})

const withFileLock = <A, E, R>(
  path: string,
  work: () => Effect.Effect<A, E, R>
): Effect.Effect<A, E | SpoolOperationError, R> =>
  Effect.acquireUseRelease(
    acquireFileLock(path),
    work,
    releaseFileLock
  )

const rewrite = Effect.fn("PiCollector.rewriteSpool")(function*(path: string, events: ReadonlyArray<TelemetryEvent>) {
  yield* fileOperation("create spool directory", dirname(path), () => mkdir(dirname(path), { recursive: true, mode: 0o700 }))
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  const body = events.length > 0 ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : ""
  yield* fileOperation("write spool", temporary, () => writeFile(temporary, body, { encoding: "utf8", mode: 0o600 }))
  yield* fileOperation("replace spool", path, () => rename(temporary, path))
  yield* fileOperation("set spool permissions", path, () => chmod(path, 0o600))
})

const decodeSpoolLine = Effect.fn("PiCollector.decodeSpoolLine")(function*(line: string) {
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(line),
    catch: (cause) => cause
  })
  return yield* Schema.decodeUnknownEffect(TelemetryEvent)(parsed)
})

const readAndQuarantine = Effect.fn("PiCollector.readAndQuarantine")(function*(path: string) {
  const contents = yield* optionalOnCode(
    fileOperation("read spool", path, () => readFile(path, "utf8")),
    "ENOENT"
  )
  if (contents === undefined) return []

  const valid: TelemetryEvent[] = []
  const invalid: string[] = []
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue
    const event = yield* decodeSpoolLine(line).pipe(Effect.match({
      onFailure: () => undefined,
      onSuccess: (value) => value
    }))
    if (event) valid.push(event)
    else invalid.push(line)
  }

  if (invalid.length > 0) {
    const invalidPath = `${path}.invalid`
    yield* fileOperation("quarantine invalid events", invalidPath, () =>
      appendFile(invalidPath, `${invalid.join("\n")}\n`, { encoding: "utf8", mode: 0o600 }))
    yield* fileOperation("set quarantine permissions", invalidPath, () => chmod(invalidPath, 0o600))
    yield* rewrite(path, valid)
  }
  return valid
})

const enqueueEffect = Effect.fn("PiCollector.enqueueTelemetry")(function*(path: string, event: TelemetryEvent) {
  yield* withFileLock(path, () => Effect.gen(function*() {
    yield* fileOperation("append event", path, () =>
      appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 }))
    yield* fileOperation("set spool permissions", path, () => chmod(path, 0o600))
  }))
})

const flushEffect = Effect.fn("PiCollector.flushTelemetry")(function*(config: LoadedConfig, path: string) {
  const valid = yield* withFileLock(path, () => readAndQuarantine(path))
  if (valid.length === 0) return 0

  const batch = valid.slice(0, 100)
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(`${config.baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(IngestBatch.make({
        clientName: "koliko-pi-extension",
        clientVersion: CLIENT_VERSION,
        events: batch
      })),
      signal
    }),
    catch: (cause) => DeliveryError.make({ message: errorMessage(cause), cause })
  })

  if (!response.ok) {
    const cause = new Error(`Koliko ingest returned HTTP ${response.status}`)
    return yield* Effect.fail(DeliveryError.make({ message: cause.message, cause }))
  }
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => DeliveryError.make({ message: errorMessage(cause), cause })
  })
  const acknowledgement = yield* Schema.decodeUnknownEffect(IngestAccepted)(body).pipe(
    Effect.mapError((cause) => DeliveryError.make({ message: errorMessage(cause), cause }))
  )
  if (acknowledgement.accepted !== batch.length) {
    const cause = new Error(`Koliko acknowledged ${acknowledgement.accepted} of ${batch.length} events`)
    return yield* Effect.fail(DeliveryError.make({ message: cause.message, cause }))
  }

  const deliveredIds = new Set(batch.map((event) => event.id))
  yield* withFileLock(path, () => Effect.gen(function*() {
    const current = yield* readAndQuarantine(path)
    yield* rewrite(path, current.filter((event) => !deliveredIds.has(event.id)))
  }))
  return batch.length
})

export class TelemetryQueue {
  private serialized: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: LoadedConfig,
    private readonly path: string
  ) {}

  enqueue(event: TelemetryEvent): Promise<void> {
    return this.lock(() => Effect.runPromise(enqueueEffect(this.path, event)))
  }

  flush(signal?: AbortSignal): Promise<number> {
    return this.lock(() => Effect.runPromise(flushEffect(this.config, this.path), { signal }))
  }

  private lock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serialized.then(work, work)
    this.serialized = result.then(() => undefined, () => undefined)
    return result
  }
}
