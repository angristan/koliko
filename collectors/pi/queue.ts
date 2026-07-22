import { appendFile, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Schema } from "effect"
import { IngestBatch, TelemetryEvent } from "../../src/shared/protocol"
import type { LoadedConfig } from "./config"

const CLIENT_VERSION = "0.1.0"

export class TelemetryQueue {
  private serialized: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: LoadedConfig,
    private readonly path: string
  ) {}

  enqueue(event: TelemetryEvent): Promise<void> {
    return this.lock(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(this.path, 0o600)
    })
  }

  flush(): Promise<number> {
    return this.lock(async () => {
      let contents: string
      try {
        contents = await readFile(this.path, "utf8")
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined
        if (code === "ENOENT") return 0
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
        await appendFile(`${this.path}.invalid`, `${invalid.join("\n")}\n`, { encoding: "utf8", mode: 0o600 })
      }
      if (valid.length === 0) {
        await this.rewrite([])
        return 0
      }

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

      await this.rewrite(valid.slice(batch.length))
      return batch.length
    })
  }

  private async rewrite(events: ReadonlyArray<TelemetryEvent>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
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
