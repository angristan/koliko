import { chmod, readFile, writeFile } from "node:fs/promises"

const configPath = "wrangler.production.jsonc"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  isRecord(value) ? value : undefined

const validSamplingRate = (value: unknown): boolean =>
  typeof value === "number" && value > 0 && value <= 1

const validateConfig = (contents: string): void => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error("Production Wrangler config must be valid JSON-compatible JSONC")
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Production Wrangler config must be an object")
  }
  if (contents.includes("replace-with-your-d1-database-id") || contents.includes("koliko.example.com")) {
    throw new Error("Production Wrangler config still contains example values")
  }

  const config = record(parsed)
  const placement = record(config?.placement)
  if (placement?.mode !== "smart") {
    throw new Error("Production Smart Placement must be enabled for the API Worker")
  }

  const assets = record(config?.assets)
  const workerFirst = assets?.run_worker_first
  if (
    !Array.isArray(workerFirst)
    || workerFirst.length !== 1
    || workerFirst[0] !== "/api/*"
  ) {
    throw new Error("Production assets must route only /api/* through the Worker")
  }

  const observability = record(config?.observability)
  const logs = record(observability?.logs)
  const traces = record(observability?.traces)
  if (
    observability?.enabled !== true
    || logs?.enabled !== true
    || logs.invocation_logs !== true
    || logs.persist !== true
    || !validSamplingRate(logs.head_sampling_rate)
    || traces?.enabled !== true
    || traces.persist !== true
    || !validSamplingRate(traces.head_sampling_rate)
  ) {
    throw new Error("Production observability must explicitly enable persisted logs and traces with a valid sampling rate")
  }
}

const encoded = process.env.KOLIKO_WRANGLER_CONFIG_B64
if (encoded) {
  const contents = Buffer.from(encoded, "base64").toString("utf8")
  validateConfig(contents)
  await writeFile(configPath, contents.endsWith("\n") ? contents : `${contents}\n`, {
    encoding: "utf8",
    mode: 0o600
  })
  await chmod(configPath, 0o600)
} else {
  let contents: string
  try {
    contents = await readFile(configPath, "utf8")
  } catch {
    throw new Error(
      "Missing wrangler.production.jsonc. Copy the example locally or set KOLIKO_WRANGLER_CONFIG_B64 in Workers Builds."
    )
  }
  validateConfig(contents)
}
