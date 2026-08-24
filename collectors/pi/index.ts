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

export interface CollectorModelSelectEvent {
  readonly model: { readonly provider: string; readonly id: string }
  readonly source: "set" | "cycle" | "restore"
}

export interface CollectorThinkingLevelSelectEvent {
  readonly level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
}

/** Runtime contract kept in the lightweight entrypoint so Pi can register every
 * event bridge before loading Effect, schemas, and the durable queue. */
export interface CollectorRuntime {
  sessionStart(event: SessionStartEvent, ctx: ExtensionContext): Promise<void>
  agentStart(event: AgentStartEvent, ctx: ExtensionContext): void
  agentSettled(event: AgentSettledEvent, ctx: ExtensionContext): Promise<void>
  messageEnd(event: MessageEndEvent, ctx: ExtensionContext): Promise<void>
  modelSelect(event: CollectorModelSelectEvent, ctx: ExtensionContext): Promise<void>
  thinkingLevelSelect(event: CollectorThinkingLevelSelectEvent, ctx: ExtensionContext): Promise<void>
  sessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<void>
  sessionTree(event: SessionTreeEvent, ctx: ExtensionContext): Promise<void>
  toolExecutionStart(event: ToolExecutionStartEvent, ctx: ExtensionContext): void
  toolExecutionEnd(event: ToolExecutionEndEvent, ctx: ExtensionContext): Promise<void>
  sessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>
  configureCommand(args: string, ctx: ExtensionCommandContext): Promise<void>
  statusCommand(args: string, ctx: ExtensionCommandContext): void
  flushCommand(args: string, ctx: ExtensionCommandContext): Promise<void>
}

export interface KolikoExtensionOptions {
  loadRuntime?: (pi: ExtensionAPI) => Promise<CollectorRuntime>
  defer?: (start: () => void) => void
}

const loadRuntime = async (pi: ExtensionAPI): Promise<CollectorRuntime> => {
  const { createKolikoRuntime } = await import("./runtime")
  return createKolikoRuntime(pi)
}

const deferUntilAfterStartup = (start: () => void): void => {
  setTimeout(start, 0)
}

/**
 * Register dependency-light bridges immediately, then initialize the collector
 * after Pi has mounted its TUI. Later events await the same initialization, so
 * telemetry is not lost when a prompt arrives before background startup ends.
 */
export function registerKolikoExtension(
  pi: ExtensionAPI,
  options: KolikoExtensionOptions = {}
): void {
  const runtimeLoader = options.loadRuntime ?? loadRuntime
  const defer = options.defer ?? deferUntilAfterStartup
  let runtimePromise: Promise<CollectorRuntime> | undefined
  let sessionReady: Promise<CollectorRuntime> | undefined

  const getRuntime = (): Promise<CollectorRuntime> => {
    runtimePromise ??= runtimeLoader(pi)
    return runtimePromise
  }

  const withRuntime = async <A>(run: (runtime: CollectorRuntime) => A | Promise<A>): Promise<A> =>
    run(await (sessionReady ?? getRuntime()))

  pi.on("session_start", (event, ctx) => {
    sessionReady = new Promise<void>((resolve) => defer(resolve))
      .then(getRuntime)
      .then(async (runtime) => {
        await runtime.sessionStart(event, ctx)
        return runtime
      })

    // session_start must stay non-blocking, but background failures still need
    // visible diagnostics and a rejection for the next event or command.
    void sessionReady.catch((error: unknown) => {
      ctx.ui.notify(
        error instanceof Error ? `Koliko initialization failed: ${error.message}` : "Koliko initialization failed",
        "error"
      )
    })
  })

  pi.on("agent_start", (event, ctx) => withRuntime((runtime) => runtime.agentStart(event, ctx)))
  pi.on("agent_settled", (event, ctx) => withRuntime((runtime) => runtime.agentSettled(event, ctx)))
  pi.on("message_end", (event, ctx) => withRuntime((runtime) => runtime.messageEnd(event, ctx)))
  pi.on("model_select", (event, ctx) => withRuntime((runtime) => runtime.modelSelect(event, ctx)))
  pi.on("thinking_level_select", (event, ctx) => withRuntime((runtime) => runtime.thinkingLevelSelect(event, ctx)))
  pi.on("session_compact", (event, ctx) => withRuntime((runtime) => runtime.sessionCompact(event, ctx)))
  pi.on("session_tree", (event, ctx) => withRuntime((runtime) => runtime.sessionTree(event, ctx)))
  pi.on("tool_execution_start", (event, ctx) => withRuntime((runtime) => runtime.toolExecutionStart(event, ctx)))
  pi.on("tool_execution_end", (event, ctx) => withRuntime((runtime) => runtime.toolExecutionEnd(event, ctx)))
  pi.on("session_shutdown", (event, ctx) => withRuntime((runtime) => runtime.sessionShutdown(event, ctx)))

  pi.registerCommand("koliko-config", {
    description: "Set the Koliko service URL (API key stays in KOLIKO_API_KEY or the private config file)",
    handler: (args, ctx) => withRuntime((runtime) => runtime.configureCommand(args, ctx))
  })

  pi.registerCommand("koliko-status", {
    description: "Show Koliko connection status",
    handler: (args, ctx) => withRuntime((runtime) => runtime.statusCommand(args, ctx))
  })

  pi.registerCommand("koliko-flush", {
    description: "Send queued Koliko events now",
    handler: (args, ctx) => withRuntime((runtime) => runtime.flushCommand(args, ctx))
  })
}

export default registerKolikoExtension
