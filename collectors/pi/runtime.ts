import { basename } from "node:path"
import type {
  AgentSettledEvent,
  AgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  MessageEndEvent,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionTreeEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent
} from "@earendil-works/pi-coding-agent"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type {
  CollectorModelSelectEvent,
  CollectorThinkingLevelSelectEvent
} from "./index"
import { TelemetryEvent, TelemetryEventType, ThinkingLevel } from "../../src/shared/telemetry-protocol"
import { configPath, loadConfig, saveBaseUrl, spoolPath, type LoadedConfig } from "./config"
import { DeliveryMonitor } from "./delivery-monitor"
import { createDeliveryStatusFeedback } from "./delivery-status"
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

const flushWithin = Effect.fn("PiCollector.flushWithin")(function*(
  flush: (signal: AbortSignal) => Promise<number>,
  milliseconds: number
) {
  yield* Effect.raceFirst(
    Effect.tryPromise({ try: flush, catch: () => undefined }).pipe(Effect.ignore),
    Effect.sleep(milliseconds)
  )
})

/**
 * The Effect-backed collector runtime.
 *
 * This module is intentionally loaded after Pi has mounted its TUI. Keep the
 * entrypoint in index.ts dependency-light so schema construction and spool
 * initialization never delay the first interactive frame.
 */
export class KolikoRuntime {
  private config: LoadedConfig | undefined
  private queue: TelemetryQueue | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private activeContext: ExtensionContext | undefined
  private sessionId = "unknown"
  private runtimeId = crypto.randomUUID()
  private repository = "unknown"
  private sequence = 0
  private runtimeStartedAt = Date.now()
  private agentStartedAt: number | undefined
  private provider: string | undefined
  private model: string | undefined
  private thinkingLevel: ThinkingLevelValue = "off"
  private readonly toolExecutions = new Map<string, { readonly startedAt: number; readonly args: unknown }>()
  private readonly deliveryMonitor: DeliveryMonitor

  constructor(private readonly pi: ExtensionAPI) {
    this.deliveryMonitor = new DeliveryMonitor(createDeliveryStatusFeedback(
      () => this.activeContext?.hasUI ? this.activeContext.ui : undefined
    ))
  }

  private readonly flushQueue = (signal?: AbortSignal): Promise<number> =>
    this.queue ? this.deliveryMonitor.flush(this.queue, signal) : Promise.resolve(0)

  private readonly flushInBackground = (): void => {
    void this.flushQueue().catch(() => undefined)
  }

  private async record(type: EventType, fields: EventFields = {}): Promise<void> {
    if (!this.queue) return
    this.sequence += 1
    const event = TelemetryEvent.make({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
      sequence: this.sequence,
      occurredAt: new Date().toISOString(),
      type,
      repository: this.repository,
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
    await this.queue.enqueue(event)

    if (this.sequence % 25 === 0) this.flushInBackground()
  }

  private recordUsage(
    usage: UsageShape,
    source: "assistant" | "tool" | "compaction" | "branch_summary",
    actualProvider = this.provider,
    actualModel = this.model
  ): Promise<void> {
    return this.record("usage", {
      ...(actualProvider !== undefined ? { provider: actualProvider } : {}),
      ...(actualModel !== undefined ? { model: actualModel } : {}),
      thinkingLevel: this.thinkingLevel,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      costTotal: usage.cost.total,
      attributes: { source }
    })
  }

  private async configure(): Promise<void> {
    this.config = await loadConfig()
    this.queue = this.config ? new TelemetryQueue(this.config, spoolPath) : undefined
    if (!this.queue) {
      this.deliveryMonitor.reset()
      if (this.activeContext?.hasUI) this.activeContext.ui.setStatus("koliko-delivery", undefined)
    }
  }

  async sessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
    this.activeContext = ctx
    await this.configure()
    if (!this.queue) return

    this.sessionId = ctx.sessionManager.getSessionId()
    this.runtimeId = crypto.randomUUID()
    this.sequence = 0
    this.runtimeStartedAt = Date.now()
    this.agentStartedAt = undefined
    this.provider = ctx.model?.provider
    this.model = ctx.model?.id
    this.thinkingLevel = this.pi.getThinkingLevel()

    const gitRoot = await this.pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3_000 })
    this.repository = basename(gitRoot.code === 0 && gitRoot.stdout.trim() ? gitRoot.stdout.trim() : ctx.cwd)

    await this.record("runtime_started", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      attributes: { reason: event.reason, mode: ctx.mode }
    })

    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(this.flushInBackground, FLUSH_INTERVAL_MS)
    this.flushInBackground()
  }

  agentStart(_event: AgentStartEvent, _ctx: ExtensionContext): void {
    if (this.agentStartedAt === undefined) this.agentStartedAt = Date.now()
  }

  async agentSettled(_event: AgentSettledEvent, _ctx: ExtensionContext): Promise<void> {
    if (this.agentStartedAt === undefined) return
    const durationMs = Date.now() - this.agentStartedAt
    this.agentStartedAt = undefined
    await this.record("agent_run", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      durationMs
    })
    this.flushInBackground()
  }

  async messageEnd(event: MessageEndEvent, _ctx: ExtensionContext): Promise<void> {
    if (event.message.role === "assistant") {
      await this.recordUsage(event.message.usage, "assistant", event.message.provider, event.message.model)
      return
    }
    if (event.message.role === "toolResult") {
      const usage = await usageProperty(event.message)
      if (usage) await this.recordUsage(usage, "tool")
    }
  }

  async modelSelect(event: CollectorModelSelectEvent, _ctx: ExtensionContext): Promise<void> {
    this.provider = event.model.provider
    this.model = event.model.id
    await this.record("model_selected", {
      provider: this.provider,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      attributes: { source: event.source }
    })
  }

  async thinkingLevelSelect(event: CollectorThinkingLevelSelectEvent, _ctx: ExtensionContext): Promise<void> {
    this.thinkingLevel = event.level
    await this.record("thinking_selected", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel
    })
  }

  async sessionCompact(event: SessionCompactEvent, _ctx: ExtensionContext): Promise<void> {
    await this.record("compaction", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      attributes: {
        reason: event.reason,
        willRetry: event.willRetry,
        tokensBefore: event.compactionEntry.tokensBefore,
        fromExtension: event.fromExtension
      }
    })
    const usage = await usageProperty(event.compactionEntry)
    if (usage) await this.recordUsage(usage, "compaction")
  }

  async sessionTree(event: SessionTreeEvent, _ctx: ExtensionContext): Promise<void> {
    const usage = await usageProperty(unknownProperty(event, "summaryEntry"))
    if (usage) await this.recordUsage(usage, "branch_summary")
  }

  toolExecutionStart(event: ToolExecutionStartEvent, _ctx: ExtensionContext): void {
    this.toolExecutions.set(event.toolCallId, { startedAt: Date.now(), args: event.args })
  }

  async toolExecutionEnd(event: ToolExecutionEndEvent, _ctx: ExtensionContext): Promise<void> {
    const execution = this.toolExecutions.get(event.toolCallId)
    this.toolExecutions.delete(event.toolCallId)
    const durationMs = execution === undefined ? 0 : Date.now() - execution.startedAt

    await this.record("tool_execution", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      toolName: event.toolName,
      durationMs,
      status: event.isError ? "error" : "success"
    })

    if (event.toolName.startsWith("goal_")) {
      const action = event.toolName.slice("goal_".length)
      await this.record("goal", {
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
      await this.record("subagent", {
        toolName: event.toolName,
        status: event.isError ? "error" : "success",
        durationMs,
        attributes: { action, count }
      })
    }
  }

  async sessionShutdown(event: SessionShutdownEvent, _ctx: ExtensionContext): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (!this.queue) return

    await this.record("runtime_ended", {
      ...(this.provider !== undefined ? { provider: this.provider } : {}),
      ...(this.model !== undefined ? { model: this.model } : {}),
      thinkingLevel: this.thinkingLevel,
      durationMs: Date.now() - this.runtimeStartedAt,
      attributes: { reason: event.reason }
    })
    await Effect.runPromise(flushWithin((signal) => this.flushQueue(signal), 2_000))
  }

  async configureCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const url = args.trim()
    if (!url) {
      ctx.ui.notify(`Usage: /koliko-config https://koliko.example.com\nConfig: ${configPath}`, "info")
      return
    }
    try {
      await saveBaseUrl(url)
      await this.configure()
      ctx.ui.notify(
        this.queue
          ? "Koliko configured and enabled."
          : `Service URL saved. Set KOLIKO_API_KEY or add apiKey to ${configPath}.`,
        "info"
      )
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Could not save Koliko configuration", "error")
    }
  }

  statusCommand(_args: string, ctx: ExtensionCommandContext): void {
    ctx.ui.notify(
      this.queue
        ? `Enabled: ${this.config?.baseUrl}\nDelivery: ${this.deliveryMonitor.isFailing ? "failing; events remain queued" : "no failure detected"}.\nRepository labels use folder names only.`
        : `Disabled. Set KOLIKO_URL and KOLIKO_API_KEY, or configure ${configPath}.`,
      "info"
    )
  }

  async flushCommand(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!this.queue) {
      ctx.ui.notify("Koliko is not configured.", "warning")
      return
    }
    try {
      this.activeContext = ctx
      const sent = await this.flushQueue()
      ctx.ui.notify(`Sent ${sent} queued event${sent === 1 ? "" : "s"}.`, "info")
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Koliko flush failed", "error")
    }
  }
}

export const createKolikoRuntime = (pi: ExtensionAPI): KolikoRuntime => new KolikoRuntime(pi)
