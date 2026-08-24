import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { describe, expect, it, vi } from "vitest"
import {
  registerKolikoExtension,
  type CollectorRuntime
} from "../collectors/pi"

type Handler = (event: any, ctx: any) => unknown
type CommandHandler = (args: string, ctx: any) => unknown

const createRuntime = (): CollectorRuntime => ({
  sessionStart: vi.fn(async () => undefined),
  agentStart: vi.fn(() => undefined),
  agentSettled: vi.fn(async () => undefined),
  messageEnd: vi.fn(async () => undefined),
  modelSelect: vi.fn(async () => undefined),
  thinkingLevelSelect: vi.fn(async () => undefined),
  sessionCompact: vi.fn(async () => undefined),
  sessionTree: vi.fn(async () => undefined),
  toolExecutionStart: vi.fn(() => undefined),
  toolExecutionEnd: vi.fn(async () => undefined),
  sessionShutdown: vi.fn(async () => undefined),
  configureCommand: vi.fn(async () => undefined),
  statusCommand: vi.fn(() => undefined),
  flushCommand: vi.fn(async () => undefined)
})

const createPi = () => {
  const handlers = new Map<string, Handler>()
  const commands = new Map<string, CommandHandler>()
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler)
    },
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commands.set(name, command.handler)
    }
  } as unknown as ExtensionAPI
  return { pi, handlers, commands }
}

const context = {
  ui: { notify: vi.fn() }
}

describe("Koliko Pi collector startup", () => {
  it("loads the heavy runtime only after session_start returns", async () => {
    const runtime = createRuntime()
    const loadRuntime = vi.fn(async () => runtime)
    let deferredStart: (() => void) | undefined
    const { pi, handlers } = createPi()

    registerKolikoExtension(pi, {
      loadRuntime,
      defer: (start) => { deferredStart = start }
    })

    const result = handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context)

    expect(result).toBeUndefined()
    expect(loadRuntime).not.toHaveBeenCalled()
    expect(runtime.sessionStart).not.toHaveBeenCalled()

    deferredStart?.()
    await handlers.get("agent_start")?.({ type: "agent_start" }, context)

    expect(loadRuntime).toHaveBeenCalledOnce()
    expect(runtime.sessionStart).toHaveBeenCalledOnce()
    expect(runtime.agentStart).toHaveBeenCalledOnce()
    expect(vi.mocked(runtime.sessionStart).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runtime.agentStart).mock.invocationCallOrder[0]
    )
  })

  it("registers commands before the runtime is loaded", async () => {
    const runtime = createRuntime()
    const loadRuntime = vi.fn(async () => runtime)
    const { pi, commands } = createPi()

    registerKolikoExtension(pi, { loadRuntime })

    expect([...commands.keys()]).toEqual(["koliko-config", "koliko-status", "koliko-flush"])
    expect(loadRuntime).not.toHaveBeenCalled()

    await commands.get("koliko-status")?.("", context)

    expect(loadRuntime).toHaveBeenCalledOnce()
    expect(runtime.statusCommand).toHaveBeenCalledWith("", context)
  })
})
