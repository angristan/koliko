import { lazy, Suspense } from "react"
import type { DashboardResponse } from "../../../shared/api"
import { ChartsFallback, InstrumentStrip } from "../../components/DashboardPrimitives"
import { integer } from "../../formatting"
import type { AnalyticsSection } from "../../navigation"
import { toolSuccessPresentation } from "../../presentation"

const AnalyticsWorkspace = lazy(() => import("./AnalyticsWorkspace").then(({ AnalyticsWorkspace }) => ({ default: AnalyticsWorkspace })))

export function AnalyticsPage({ dashboard, section, onSectionChange }: {
  readonly dashboard: DashboardResponse | undefined
  readonly section: AnalyticsSection
  readonly onSectionChange: (section: AnalyticsSection) => void
}) {
  const summary = dashboard?.summary
  const toolSuccess = toolSuccessPresentation(summary?.toolCalls ?? 0, summary?.toolErrors ?? 0)
  const summaryStrip = (
    <InstrumentStrip metrics={[
      { group: "Event activity", label: "Tool calls", value: integer.format(summary?.toolCalls ?? 0), detail: summary?.toolCalls ? `${toolSuccess.value} successful` : "No calls", progress: toolSuccess.progress, color: "sage" },
      { group: "Event activity", label: "Compactions", value: integer.format(summary?.compactions ?? 0), detail: "context checkpoints", color: "sky" },
      { group: "Event activity", label: "Goal events", value: integer.format(summary?.goals ?? 0), detail: "lifecycle updates", color: "honey" },
      { group: "Event activity", label: "Sub-agent events", value: integer.format(summary?.subagents ?? 0), detail: "delegated work", color: "sky" }
    ]} />
  )

  return (
    <Suspense fallback={<ChartsFallback />}>
      <AnalyticsWorkspace dashboard={dashboard} summary={summaryStrip} section={section} onSectionChange={onSectionChange} />
    </Suspense>
  )
}
