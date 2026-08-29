import type {
  ExtensionAPI,
  ExtensionContext,
  UIPromptEndEvent,
  UIPromptStartEvent
} from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const capturedEvents = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock("../collectors/pi/config", () => ({
  configPath: "/tmp/koliko-test/config.json",
  spoolPath: "/tmp/koliko-test/spool.jsonl",
  loadConfig: async () => ({ baseUrl: "https://koliko.example.com", apiKey: "test-key" }),
  saveBaseUrl: async () => undefined
}))

vi.mock("../collectors/pi/queue", () => ({
  TelemetryQueue: class {
    async enqueue(event: Record<string, unknown>): Promise<void> {
      capturedEvents.push(event)
    }

    async flush(): Promise<number> {
      return 0
    }
  }
}))

import { KolikoRuntime } from "../collectors/pi/runtime"

const pi = {
  exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "", killed: false })),
  getThinkingLevel: vi.fn(() => "high")
} as unknown as ExtensionAPI

const context = {
  cwd: "/workspace/example",
  hasUI: false,
  mode: "tui",
  model: { provider: "test-provider", id: "test-model" },
  sessionManager: { getSessionId: () => "session-1" }
} as unknown as ExtensionContext

const promptStart: UIPromptStartEvent = {
  type: "ui_prompt_start",
  reason: "ui_prompt",
  kind: "input",
  title: "Do not collect this question"
}

const promptEnd: UIPromptEndEvent = {
  type: "ui_prompt_end",
  reason: "ui_prompt",
  kind: "input",
  title: "Do not collect this question"
}

describe("Koliko Pi collector runtime", () => {
  beforeEach(() => {
    capturedEvents.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("excludes UI prompt waits from active agent time without collecting prompt content", async () => {
    const runtime = new KolikoRuntime(pi)
    await runtime.sessionStart({ type: "session_start", reason: "startup" }, context)

    vi.setSystemTime(2_000)
    runtime.agentStart({ type: "agent_start" }, context)
    vi.setSystemTime(4_000)
    runtime.uiPromptStart(promptStart, context)
    vi.setSystemTime(6_000)
    runtime.uiPromptEnd(promptEnd, context)
    vi.setSystemTime(8_000)
    runtime.uiPromptStart(promptStart, context)
    vi.setSystemTime(9_000)
    runtime.uiPromptEnd(promptEnd, context)
    vi.setSystemTime(12_000)
    await runtime.agentSettled({ type: "agent_settled" }, context)

    const event = capturedEvents.find((candidate) => candidate.type === "agent_run")
    expect(event).toMatchObject({
      durationMs: 7_000,
      attributes: {
        elapsedMs: 10_000,
        uiPromptWaitMs: 3_000
      }
    })
    expect(JSON.stringify(event)).not.toContain(promptStart.title)
  })

  it("keeps the elapsed duration when no UI prompt blocks the run", async () => {
    const runtime = new KolikoRuntime(pi)
    await runtime.sessionStart({ type: "session_start", reason: "startup" }, context)

    vi.setSystemTime(1_000)
    runtime.agentStart({ type: "agent_start" }, context)
    vi.setSystemTime(4_000)
    await runtime.agentSettled({ type: "agent_settled" }, context)

    const event = capturedEvents.find((candidate) => candidate.type === "agent_run")
    expect(event).toMatchObject({ durationMs: 3_000 })
    expect(event).not.toHaveProperty("attributes")
  })
})
