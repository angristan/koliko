import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"
import { Schema } from "effect"

const TrackerConfig = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  apiKey: Schema.optionalKey(Schema.NonEmptyString),
  enabled: Schema.optionalKey(Schema.Boolean)
})

export interface LoadedConfig {
  readonly baseUrl: string
  readonly apiKey: string
}

export const configPath = join(getAgentDir(), "traker", "config.json")
export const spoolPath = join(getAgentDir(), "traker", "spool.jsonl")

export const loadConfig = async (): Promise<LoadedConfig | undefined> => {
  const environmentBaseUrl = process.env.TRAKER_URL
  const environmentApiKey = process.env.TRAKER_API_KEY

  let fileConfig: typeof TrackerConfig.Type | undefined
  try {
    const contents = await readFile(configPath, "utf8")
    const parsed: unknown = JSON.parse(contents)
    fileConfig = await Schema.decodeUnknownPromise(TrackerConfig)(parsed)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code !== "ENOENT") throw error
  }

  if (fileConfig?.enabled === false) return undefined
  const baseUrl = environmentBaseUrl ?? fileConfig?.baseUrl
  const apiKey = environmentApiKey ?? fileConfig?.apiKey
  if (!baseUrl || !apiKey) return undefined

  const normalized = new URL(baseUrl)
  if (normalized.protocol !== "https:" && normalized.hostname !== "localhost" && normalized.hostname !== "127.0.0.1") {
    throw new Error("Traker URL must use HTTPS outside localhost")
  }

  return {
    baseUrl: normalized.toString().replace(/\/$/u, ""),
    apiKey
  }
}

export const saveBaseUrl = async (baseUrl: string): Promise<void> => {
  const normalized = new URL(baseUrl)
  if (normalized.protocol !== "https:" && normalized.hostname !== "localhost" && normalized.hostname !== "127.0.0.1") {
    throw new Error("Traker URL must use HTTPS outside localhost")
  }

  let existingApiKey: string | undefined
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"))
    const existing = await Schema.decodeUnknownPromise(TrackerConfig)(parsed)
    existingApiKey = existing.apiKey
  } catch {
    existingApiKey = undefined
  }

  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 })
  const value = {
    baseUrl: normalized.toString().replace(/\/$/u, ""),
    ...(existingApiKey !== undefined ? { apiKey: existingApiKey } : {})
  }
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await chmod(configPath, 0o600)
}
