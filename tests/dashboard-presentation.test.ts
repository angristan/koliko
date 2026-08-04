import { describe, expect, it } from "vitest"
import { SummaryMetrics } from "../src/shared/api"
import {
  apiKeyRevocationMessage,
  hasCollectedData,
  loadingRangeMessage,
  retainedRangeMessage,
  toolSuccessPresentation
} from "../src/dashboard/presentation"

const emptySummary = SummaryMetrics.make({
  sessions: 0,
  turns: 0,
  trackedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
  toolCalls: 0,
  toolErrors: 0,
  compactions: 0,
  goals: 0,
  subagents: 0
})

describe("dashboard presentation states", () => {
  it("does not claim perfect tool success before any calls", () => {
    expect(toolSuccessPresentation(0, 0)).toEqual({ value: "—", detail: "No calls" })
    expect(toolSuccessPresentation(8, 2)).toEqual({ value: "75.0%", detail: "8 calls", progress: 75 })
  })

  it("distinguishes first use from collected activity", () => {
    expect(hasCollectedData(emptySummary)).toBe(false)
    expect(hasCollectedData(SummaryMetrics.make({ ...emptySummary, subagents: 1 }))).toBe(true)
  })

  it("identifies requested and retained ranges", () => {
    const requested = { from: "2026-02-01", to: "2026-03-02" }
    const retained = { from: "2026-02-24", to: "2026-03-02" }

    expect(loadingRangeMessage(requested, retained)).toContain("Loading 2026-02-01 to 2026-03-02")
    expect(retainedRangeMessage(requested, retained)).toBe(
      "Could not load 2026-02-01 to 2026-03-02. Showing retained data for 2026-02-24 to 2026-03-02. This data is stale."
    )
  })

  it("names the revoked collector and explains the consequence", () => {
    expect(apiKeyRevocationMessage("Office Mac collector")).toBe(
      "Revoke “Office Mac collector”? Ingestion from this collector will stop until it is configured with an active key."
    )
  })
})
