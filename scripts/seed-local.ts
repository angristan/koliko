import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DAY_MS = 86_400_000
const SESSION_COUNT = 96
const RANGE_DAYS = 90
const SEED_KEY_ID = "seed_local_development"

type Model = {
  readonly provider: string
  readonly model: string
  readonly inputRate: number
  readonly outputRate: number
}

type SeedEvent = {
  readonly id: string
  readonly sessionId: string
  readonly runtimeId: string
  readonly sequence: number
  readonly occurredAt: string
  readonly type: string
  readonly repository: string
  readonly provider?: string
  readonly model?: string
  readonly thinkingLevel?: string
  readonly durationMs?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly totalTokens?: number
  readonly costTotal?: number
  readonly toolName?: string
  readonly status?: string
  readonly attributes?: Readonly<Record<string, string | number | boolean | null>>
}

const models: ReadonlyArray<Model> = [
  { provider: "anthropic", model: "claude-sonnet-4-5", inputRate: 3, outputRate: 15 },
  { provider: "openai", model: "gpt-5.2", inputRate: 1.75, outputRate: 14 },
  { provider: "google", model: "gemini-3-pro", inputRate: 2, outputRate: 12 },
  { provider: "mistral", model: "devstral-2", inputRate: 0.4, outputRate: 2 }
]

const repositories = [
  "koliko", "koliko", "koliko",
  "edge-console", "edge-console",
  "agent-toolkit", "docs-site", "infrastructure"
] as const

const thinkingLevels = ["low", "medium", "medium", "high", "high", "xhigh"] as const
const tools = [
  "read", "read", "read", "bash", "bash", "edit", "grep", "find", "web_search", "agents"
] as const

const randomGenerator = (seed: number): (() => number) => {
  let value = seed
  return () => {
    value |= 0
    value = value + 0x6d2b79f5 | 0
    let result = Math.imul(value ^ value >>> 15, 1 | value)
    result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result
    return ((result ^ result >>> 14) >>> 0) / 4_294_967_296
  }
}

const random = randomGenerator(0x4b4f4c49)
const integerBetween = (minimum: number, maximum: number): number =>
  Math.floor(random() * (maximum - minimum + 1)) + minimum
const pick = <T>(values: ReadonlyArray<T>): T => values[Math.floor(random() * values.length)]!
const chance = (probability: number): boolean => random() < probability
const rounded = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`
const sqlValue = (value: string | number | undefined): string => {
  if (value === undefined) return "NULL"
  return typeof value === "number" ? String(value) : sqlString(value)
}

const eventSql = (event: SeedEvent): string => `(${[
  sqlString(event.id),
  "1",
  sqlString(SEED_KEY_ID),
  sqlString(event.sessionId),
  sqlString(event.runtimeId),
  String(event.sequence),
  sqlString(event.occurredAt),
  sqlString(event.type),
  sqlString(event.repository),
  sqlValue(event.provider),
  sqlValue(event.model),
  sqlValue(event.thinkingLevel),
  sqlValue(event.durationMs),
  sqlValue(event.inputTokens),
  sqlValue(event.outputTokens),
  sqlValue(event.cacheReadTokens),
  sqlValue(event.cacheWriteTokens),
  sqlValue(event.totalTokens),
  sqlValue(event.costTotal),
  sqlValue(event.toolName),
  sqlValue(event.status),
  sqlString(JSON.stringify(event.attributes ?? {}))
].join(", ")})`

const generateEvents = (now: Date): ReadonlyArray<SeedEvent> => {
  const events: SeedEvent[] = []
  let eventNumber = 0

  for (let sessionNumber = 1; sessionNumber <= SESSION_COUNT; sessionNumber += 1) {
    const dayOffset = sessionNumber <= 48
      ? (sessionNumber * 11 + integerBetween(0, 2)) % 30
      : 30 + (sessionNumber * 17 + integerBetween(0, 3)) % (RANGE_DAYS - 30)
    let cursor = now.getTime() - dayOffset * DAY_MS - integerBetween(4, 14) * 3_600_000
    const sessionId = `seed_session_${String(sessionNumber).padStart(3, "0")}`
    const runtimeId = `seed_runtime_${String(sessionNumber).padStart(3, "0")}`
    const repository = pick(repositories)
    const selectedModel = pick(models)
    const thinkingLevel = pick(thinkingLevels)
    let sequence = 0

    const add = (
      type: string,
      fields: Omit<Partial<SeedEvent>, "id" | "sessionId" | "runtimeId" | "sequence" | "occurredAt" | "type" | "repository"> = {},
      advanceMs = integerBetween(2_000, 18_000)
    ): void => {
      eventNumber += 1
      sequence += 1
      events.push({
        id: `seed_event_${String(eventNumber).padStart(6, "0")}`,
        sessionId,
        runtimeId,
        sequence,
        occurredAt: new Date(cursor).toISOString(),
        type,
        repository,
        ...fields
      })
      cursor += advanceMs
    }

    add("runtime_started", { status: "started", attributes: { client: "pi" } })
    add("model_selected", { provider: selectedModel.provider, model: selectedModel.model })
    add("thinking_selected", { thinkingLevel })

    const hasGoal = chance(0.58)
    if (hasGoal) add("goal", { status: "created", attributes: { source: "user" } })

    const turnCount = integerBetween(6, 18)
    for (let turn = 0; turn < turnCount; turn += 1) {
      const runDuration = integerBetween(35_000, 420_000)
      add("agent_run", { durationMs: runDuration, status: "completed" }, runDuration)

      const inputTokens = integerBetween(4_000, 38_000)
      const outputTokens = integerBetween(700, 7_500)
      const cacheReadTokens = chance(0.82) ? integerBetween(1_000, Math.max(1_001, inputTokens * 2)) : 0
      const cacheWriteTokens = chance(0.34) ? integerBetween(500, 8_000) : 0
      const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
      const costTotal = rounded(
        (inputTokens + cacheReadTokens * 0.1 + cacheWriteTokens * 1.25) / 1_000_000 * selectedModel.inputRate
        + outputTokens / 1_000_000 * selectedModel.outputRate
      )

      add("usage", {
        provider: selectedModel.provider,
        model: selectedModel.model,
        thinkingLevel,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        costTotal,
        attributes: { source: "assistant" }
      })

      const toolCount = integerBetween(1, 5)
      for (let tool = 0; tool < toolCount; tool += 1) {
        const toolName = pick(tools)
        const failed = chance(toolName === "bash" ? 0.055 : 0.018)
        add("tool_execution", {
          toolName,
          status: failed ? "error" : "completed",
          durationMs: integerBetween(18, toolName === "agents" ? 180_000 : 42_000)
        })
      }

      if (turn > 2 && chance(0.075)) {
        add("compaction", {
          provider: selectedModel.provider,
          model: selectedModel.model,
          status: "completed",
          attributes: {
            reason: chance(0.72) ? "context_limit" : "manual",
            tokensBefore: integerBetween(72_000, 190_000)
          }
        })
      }

      if (chance(0.045)) {
        add("subagent", { status: "started", attributes: { action: "spawn" } })
        add("subagent", { status: "completed", attributes: { action: "wait" } }, integerBetween(40_000, 240_000))
        add("subagent", { status: "completed", attributes: { action: "close" } })
      }
    }

    if (hasGoal) {
      add("goal", { status: chance(0.84) ? "completed" : "blocked", attributes: { source: "agent" } })
    }
    add("runtime_ended", { status: "completed" })
  }

  return events
}

const buildSql = (events: ReadonlyArray<SeedEvent>, now: Date): string => {
  const columns = `(
    event_id, schema_version, api_key_id, session_id, runtime_id, sequence,
    occurred_at, event_type, repository, provider, model, thinking_level,
    duration_ms, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    total_tokens, cost_total, tool_name, status, attributes_json
  )`
  const statements = [
    "PRAGMA foreign_keys = ON;",
    "DELETE FROM telemetry_events WHERE event_id GLOB 'seed_event_*';",
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at, revoked_at)
     VALUES (${sqlString(SEED_KEY_ID)}, 'Local demo data', 'seed_demo', '${"f".repeat(64)}', ${sqlString(now.toISOString())}, ${sqlString(now.toISOString())})
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, revoked_at = excluded.revoked_at;`
  ]

  const chunkSize = 200
  for (let offset = 0; offset < events.length; offset += chunkSize) {
    const values = events.slice(offset, offset + chunkSize).map(eventSql).join(",\n")
    statements.push(`INSERT INTO telemetry_events ${columns} VALUES\n${values};`)
  }

  return `${statements.join("\n\n")}\n`
}

const now = new Date()
const events = generateEvents(now)
const directory = await mkdtemp(join(tmpdir(), "koliko-seed-"))
const seedPath = join(directory, "seed.sql")

try {
  await writeFile(seedPath, buildSql(events, now), { encoding: "utf8", mode: 0o600 })
  const { stdout, stderr } = await execFileAsync(
    "bunx",
    ["wrangler", "d1", "execute", "koliko", "--local", "--file", seedPath],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }
  )
  if (stdout.trim()) process.stdout.write(stdout)
  if (stderr.trim()) process.stderr.write(stderr)
  console.log(`Seeded ${SESSION_COUNT} sessions and ${events.length.toLocaleString("en")} events across the last ${RANGE_DAYS} days.`)
  console.log("Re-running this command replaces only previously seeded events; collected local data is preserved.")
} finally {
  await rm(directory, { recursive: true, force: true })
}
