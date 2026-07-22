import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { basename } from "node:path"
import { Schema } from "effect"
import { TelemetryEvent, TelemetryEventType, ThinkingLevel } from "../../src/shared/protocol"
import { configPath, loadConfig, saveBaseUrl, spoolPath, type LoadedConfig } from "./config"
import { TelemetryQueue } from "./queue"

const FLUSH_INTERVAL_MS = 15_000

const UsagePayload = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Struct({ total: Schema.Number })
})

type UsageShape = typeof UsagePayload.Type
type ThinkingLevelValue = typeof ThinkingLevel.Type
type EventType = typeof TelemetryEventType.Type

interface EventFields {
  readonly provider?: string
  readonly model?: string
  readonly thinkingLevel?: ThinkingLevelValue
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringProperty = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined
  const property = value[key]
  return typeof property === "string" ? property : undefined
}

const arrayLength = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) return undefined
  const property = value[key]
  return Array.isArray(property) ? property.length : undefined
}

const usageProperty = async (value: unknown): Promise<UsageShape | undefined> => {
  if (!isRecord(value) || value.usage === undefined) return undefined
  try {
    return await Schema.decodeUnknownPromise(UsagePayload)(value.usage)
  } catch {
    return undefined
  }
}

const unknownProperty = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined

const withTimeout = async (work: Promise<unknown>, milliseconds: number): Promise<void> => {
  await Promise.race([
    work.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  ])
}

export default function trackerExtension(pi: ExtensionAPI) {
  let config: LoadedConfig | undefined
  let queue: TelemetryQueue | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let sessionId = "unknown"
  let runtimeId = crypto.randomUUID()
  let repository = "unknown"
  let sequence = 0
  let runtimeStartedAt = Date.now()
  let agentStartedAt: number | undefined
  let provider: string | undefined
  let model: string | undefined
  let thinkingLevel: ThinkingLevelValue = "off"
  const toolExecutions = new Map<string, { readonly startedAt: number; readonly args: unknown }>()

  const record = async (
    type: EventType,
    fields: EventFields = {}
  ): Promise<void> => {
    if (!queue) return
    sequence += 1
    const event = TelemetryEvent.make({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      sessionId,
      runtimeId,
      sequence,
      occurredAt: new Date().toISOString(),
      type,
      repository,
      ...(fields.provider !== undefined ? { provider: fields.provider } : {}),
      ...(fields.model !== undefined ? { model: fields.model } : {}),
      ...(fields.thinkingLevel !== undefined ? { thinkingLevel: fields.thinkingLevel } : {}),
      ...(fields.durationMs !== undefined ? { durationMs: fields.durationMs } : {}),
      ...(fields.inputTokens !== undefined ? { inputTokens: fields.inputTokens } : {}),
      ...(fields.outputTokens !== undefined ? { outputTokens: fields.outputTokens } : {}),
      ...(fields.cacheReadTokens !== undefined ? { cacheReadTokens: fields.cacheReadTokens } : {}),
      ...(fields.cacheWriteTokens !== undefined ? { cacheWriteTokens: fields.cacheWriteTokens } : {}),
      ...(fields.totalTokens !== undefined ? { totalTokens: fields.totalTokens } : {}),
      ...(fields.costTotal !== undefined ? { costTotal: fields.costTotal } : {}),
      ...(fields.toolName !== undefined ? { toolName: fields.toolName } : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.attributes !== undefined ? { attributes: fields.attributes } : {})
    })
    await queue.enqueue(event)

    if (sequence % 25 === 0) void queue.flush().catch(() => undefined)
  }

  const recordUsage = (
    usage: UsageShape,
    source: "assistant" | "tool" | "compaction" | "branch_summary",
    actualProvider = provider,
    actualModel = model
  ): Promise<void> => record("usage", {
    ...(actualProvider !== undefined ? { provider: actualProvider } : {}),
    ...(actualModel !== undefined ? { model: actualModel } : {}),
    thinkingLevel,
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    costTotal: usage.cost.total,
    attributes: { source }
  })

  const configure = async (): Promise<void> => {
    config = await loadConfig()
    queue = config ? new TelemetryQueue(config, spoolPath) : undefined
  }

  pi.on("session_start", async (event, ctx) => {
    await configure()
    if (!queue) return

    sessionId = ctx.sessionManager.getSessionId()
    runtimeId = crypto.randomUUID()
    sequence = 0
    runtimeStartedAt = Date.now()
    agentStartedAt = undefined
    provider = ctx.model?.provider
    model = ctx.model?.id
    thinkingLevel = pi.getThinkingLevel()

    const gitRoot = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3_000 })
    repository = basename(gitRoot.code === 0 && gitRoot.stdout.trim() ? gitRoot.stdout.trim() : ctx.cwd)

    await record("runtime_started", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel,
      attributes: { reason: event.reason, mode: ctx.mode }
    })

    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      void queue?.flush().catch(() => undefined)
    }, FLUSH_INTERVAL_MS)
    void queue.flush().catch(() => undefined)
  })

  pi.on("agent_start", async () => {
    if (agentStartedAt === undefined) agentStartedAt = Date.now()
  })

  pi.on("agent_settled", async () => {
    if (agentStartedAt === undefined) return
    const durationMs = Date.now() - agentStartedAt
    agentStartedAt = undefined
    await record("agent_run", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel,
      durationMs
    })
    void queue?.flush().catch(() => undefined)
  })

  pi.on("message_end", async (event) => {
    if (event.message.role === "assistant") {
      await recordUsage(event.message.usage, "assistant", event.message.provider, event.message.model)
      return
    }
    if (event.message.role === "toolResult") {
      const usage = await usageProperty(event.message)
      if (usage) await recordUsage(usage, "tool")
    }
  })

  pi.on("model_select", async (event) => {
    provider = event.model.provider
    model = event.model.id
    await record("model_selected", {
      provider,
      model,
      thinkingLevel,
      attributes: { source: event.source }
    })
  })

  pi.on("thinking_level_select", async (event) => {
    thinkingLevel = event.level
    await record("thinking_selected", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel
    })
  })

  pi.on("session_compact", async (event) => {
    await record("compaction", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel,
      attributes: {
        reason: event.reason,
        willRetry: event.willRetry,
        tokensBefore: event.compactionEntry.tokensBefore,
        fromExtension: event.fromExtension
      }
    })
    const usage = await usageProperty(event.compactionEntry)
    if (usage) await recordUsage(usage, "compaction")
  })

  pi.on("session_tree", async (event) => {
    const usage = await usageProperty(unknownProperty(event, "summaryEntry"))
    if (usage) await recordUsage(usage, "branch_summary")
  })

  pi.on("tool_execution_start", async (event) => {
    toolExecutions.set(event.toolCallId, { startedAt: Date.now(), args: event.args })
  })

  pi.on("tool_execution_end", async (event) => {
    const execution = toolExecutions.get(event.toolCallId)
    toolExecutions.delete(event.toolCallId)
    const durationMs = execution === undefined ? 0 : Date.now() - execution.startedAt

    await record("tool_execution", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel,
      toolName: event.toolName,
      durationMs,
      status: event.isError ? "error" : "success"
    })

    if (event.toolName.startsWith("goal_")) {
      const action = event.toolName.slice("goal_".length)
      await record("goal", {
        toolName: event.toolName,
        status: event.isError ? "error" : action,
        attributes: { action }
      })
    }

    if (event.toolName === "agents" || event.toolName === "subagent") {
      const action = stringProperty(execution?.args, "action")
        ?? (arrayLength(execution?.args, "tasks") !== undefined ? "parallel" : undefined)
        ?? (arrayLength(execution?.args, "chain") !== undefined ? "chain" : "single")
      const count = arrayLength(execution?.args, "tasks")
        ?? arrayLength(execution?.args, "chain")
        ?? 1
      await record("subagent", {
        toolName: event.toolName,
        status: event.isError ? "error" : "success",
        durationMs,
        attributes: { action, count }
      })
    }
  })

  pi.on("session_shutdown", async (event) => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (!queue) return

    await record("runtime_ended", {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      thinkingLevel,
      durationMs: Date.now() - runtimeStartedAt,
      attributes: { reason: event.reason }
    })
    await withTimeout(queue.flush().catch(() => undefined), 2_000)
  })

  pi.registerCommand("traker-config", {
    description: "Set the Traker service URL (API key stays in TRAKER_API_KEY or the private config file)",
    handler: async (args, ctx) => {
      const url = args.trim()
      if (!url) {
        ctx.ui.notify(`Usage: /traker-config https://traker.example.com\nConfig: ${configPath}`, "info")
        return
      }
      try {
        await saveBaseUrl(url)
        await configure()
        ctx.ui.notify(
          queue
            ? "Traker configured and enabled."
            : `Service URL saved. Set TRAKER_API_KEY or add apiKey to ${configPath}.`,
          "info"
        )
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Could not save Traker configuration", "error")
      }
    }
  })

  pi.registerCommand("traker-status", {
    description: "Show Traker connection status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        queue
          ? `Enabled: ${config?.baseUrl}\nRepository labels use folder names only.`
          : `Disabled. Set TRAKER_URL and TRAKER_API_KEY, or configure ${configPath}.`,
        "info"
      )
    }
  })

  pi.registerCommand("traker-flush", {
    description: "Send queued Traker events now",
    handler: async (_args, ctx) => {
      if (!queue) {
        ctx.ui.notify("Traker is not configured.", "warning")
        return
      }
      try {
        const sent = await queue.flush()
        ctx.ui.notify(`Sent ${sent} queued event${sent === 1 ? "" : "s"}.`, "info")
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "Traker flush failed", "error")
      }
    }
  })
}
