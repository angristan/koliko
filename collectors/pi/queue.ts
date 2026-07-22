import { appendFile, chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Schema } from "effect"
import { IngestBatch, TelemetryEvent } from "../../src/shared/protocol"
import type { LoadedConfig } from "./config"

const CLIENT_VERSION = "0.1.0"
const LOCK_RETRY_MS = 10
const STALE_LOCK_MS = 60_000

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const removeStaleLock = async (path: string): Promise<void> => {
  try {
    const details = await stat(path)
    if (Date.now() - details.mtimeMs <= STALE_LOCK_MS) return
    await unlink(path)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

const withFileLock = async <T>(path: string, work: () => Promise<T>): Promise<T> => {
  const lockPath = `${path}.lock`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })

  let handle
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
      await removeStaleLock(lockPath)
      await delay(LOCK_RETRY_MS)
    }
  }

  try {
    return await work()
  } finally {
    await handle.close()
    try {
      await unlink(lockPath)
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
  }
}

export class TelemetryQueue {
  private serialized: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: LoadedConfig,
    private readonly path: string
  ) {}

  enqueue(event: TelemetryEvent): Promise<void> {
    return this.lock(() => withFileLock(this.path, async () => {
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(this.path, 0o600)
    }))
  }

  flush(): Promise<number> {
    return this.lock(async () => {
      const valid = await withFileLock(this.path, () => this.readAndQuarantine())
      if (valid.length === 0) return 0

      const batch = valid.slice(0, 100)
      const response = await fetch(`${this.config.baseUrl}/api/v1/events`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(IngestBatch.make({
          clientName: "traker-pi-extension",
          clientVersion: CLIENT_VERSION,
          events: batch
        }))
      })

      if (!response.ok) {
        throw new Error(`Traker ingest returned HTTP ${response.status}`)
      }

      const deliveredIds = new Set(batch.map((event) => event.id))
      await withFileLock(this.path, async () => {
        const current = await this.readAndQuarantine()
        await this.rewrite(current.filter((event) => !deliveredIds.has(event.id)))
      })
      return batch.length
    })
  }

  private async readAndQuarantine(): Promise<ReadonlyArray<TelemetryEvent>> {
    let contents: string
    try {
      contents = await readFile(this.path, "utf8")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return []
      throw error
    }

    const valid: TelemetryEvent[] = []
    const invalid: string[] = []
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue
      try {
        const parsed: unknown = JSON.parse(line)
        valid.push(await Schema.decodeUnknownPromise(TelemetryEvent)(parsed))
      } catch {
        invalid.push(line)
      }
    }

    if (invalid.length > 0) {
      const invalidPath = `${this.path}.invalid`
      await appendFile(invalidPath, `${invalid.join("\n")}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(invalidPath, 0o600)
      await this.rewrite(valid)
    }
    return valid
  }

  private async rewrite(events: ReadonlyArray<TelemetryEvent>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`
    const body = events.length > 0 ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : ""
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, this.path)
    await chmod(this.path, 0o600)
  }

  private lock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serialized.then(work, work)
    this.serialized = result.then(() => undefined, () => undefined)
    return result
  }
}
