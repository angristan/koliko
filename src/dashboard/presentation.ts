import type { SummaryMetrics } from "../shared/api"

export interface DateRange {
  readonly from: string
  readonly to: string
}

export interface ToolSuccessPresentation {
  readonly value: string
  readonly detail: string
  readonly progress?: number
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

export const toolSuccessPresentation = (calls: number, errors: number): ToolSuccessPresentation => {
  if (calls === 0) return { value: "—", detail: "No calls" }

  const successRate = Math.max(0, Math.min(1, 1 - errors / calls))
  return {
    value: percent(successRate),
    detail: `${new Intl.NumberFormat("en").format(calls)} calls`,
    progress: successRate * 100
  }
}

export const hasCollectedData = (summary: SummaryMetrics): boolean => [
  summary.sessions,
  summary.turns,
  summary.trackedMs,
  summary.inputTokens,
  summary.outputTokens,
  summary.cacheReadTokens,
  summary.cacheWriteTokens,
  summary.totalTokens,
  summary.cost,
  summary.toolCalls,
  summary.compactions,
  summary.goals,
  summary.subagents
].some((value) => value > 0)

export const formatDateRange = ({ from, to }: DateRange): string => `${from} to ${to}`

export const retainedRangeMessage = (requested: DateRange, retained: DateRange): string =>
  `Could not load ${formatDateRange(requested)}. Showing retained data for ${formatDateRange(retained)}. This data is stale.`

export const loadingRangeMessage = (requested: DateRange, retained: DateRange): string =>
  `Loading ${formatDateRange(requested)}. Showing ${formatDateRange(retained)} until the new range is ready.`

export const apiKeyRevocationMessage = (name: string): string =>
  `Revoke “${name}”? Ingestion from this collector will stop until it is configured with an active key.`
