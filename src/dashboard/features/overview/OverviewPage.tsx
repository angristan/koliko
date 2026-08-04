import { lazy, Suspense } from "react"
import { Stack } from "@mantine/core"
import type { DashboardResponse } from "../../../shared/api"
import { ChartsFallback, InstrumentStrip } from "../../components/DashboardPrimitives"
import { compactNumber, formatDuration, formatPercent, integer, money } from "../../formatting"
import type { TrendMetric } from "../../navigation"
import { toolSuccessPresentation } from "../../presentation"

const OverviewCharts = lazy(() => import("./OverviewCharts").then(({ OverviewCharts }) => ({ default: OverviewCharts })))

export function OverviewPage({ dashboard, trendMetric, onTrendMetricChange }: {
  readonly dashboard: DashboardResponse | undefined
  readonly trendMetric: TrendMetric
  readonly onTrendMetricChange: (metric: TrendMetric) => void
}) {
  const summary = dashboard?.summary
  const cacheDenominator = (summary?.inputTokens ?? 0) + (summary?.cacheReadTokens ?? 0)
  const cacheRate = cacheDenominator === 0 ? 0 : (summary?.cacheReadTokens ?? 0) / cacheDenominator
  const toolSuccess = toolSuccessPresentation(summary?.toolCalls ?? 0, summary?.toolErrors ?? 0)

  return (
    <Stack gap="sm">
      <InstrumentStrip metrics={[
        { group: "Activity", label: "Sessions", value: integer.format(summary?.sessions ?? 0), detail: `${integer.format(summary?.turns ?? 0)} turns`, color: "sky" },
        { group: "Activity", label: "Agent time", value: formatDuration(summary?.trackedMs ?? 0), detail: "active runtime", color: "sage" },
        { group: "Activity", label: "Tokens", value: compactNumber.format(summary?.totalTokens ?? 0), detail: `${compactNumber.format(summary?.outputTokens ?? 0)} output`, color: "sky" },
        { group: "Activity", label: "Cost", value: money.format(summary?.cost ?? 0), detail: "provider reported", color: "honey" },
        { group: "Efficiency", label: "Cache read", value: formatPercent(cacheRate), detail: `${compactNumber.format(summary?.cacheReadTokens ?? 0)} tokens`, progress: cacheRate * 100, color: "sky" },
        { group: "Efficiency", label: "Tool success", value: toolSuccess.value, detail: toolSuccess.detail, progress: toolSuccess.progress, color: "sage" }
      ]} />
      <Suspense fallback={<ChartsFallback />}>
        <OverviewCharts dashboard={dashboard} metric={trendMetric} onMetricChange={onTrendMetricChange} />
      </Suspense>
    </Stack>
  )
}
