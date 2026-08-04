import type { ReactNode } from "react"
import { Box, ScrollArea, Tabs } from "@mantine/core"
import { CoinsIcon, CurrencyDollarIcon, ListBulletsIcon, SparkleIcon, WrenchIcon } from "@phosphor-icons/react"
import { DashboardResponse, SummaryMetrics } from "../../../shared/api"
import type { AnalyticsSection } from "../../navigation"
import { hasCollectedData } from "../../presentation"
import { CollectorSetup } from "./chartSupport"
import { CostAnalytics } from "./CostAnalytics"
import { FeaturesAnalytics } from "./FeaturesAnalytics"
import { SessionsAnalytics } from "./SessionsAnalytics"
import { ToolsAnalytics } from "./ToolsAnalytics"
import { UsageAnalytics } from "./UsageAnalytics"

const EMPTY_DASHBOARD = DashboardResponse.make({
  from: "",
  to: "",
  summary: SummaryMetrics.make({
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
  }),
  daily: [],
  models: [],
  thinking: [],
  repositories: [],
  tools: [],
  features: [],
  sessions: []
})

export function AnalyticsWorkspace({
  dashboard,
  summary,
  section,
  onSectionChange
}: {
  readonly dashboard: DashboardResponse | undefined
  readonly summary: ReactNode
  readonly section: AnalyticsSection
  readonly onSectionChange: (section: AnalyticsSection) => void
}) {
  const data = dashboard ?? EMPTY_DASHBOARD
  const firstUse = dashboard !== undefined && !hasCollectedData(dashboard.summary)

  return (
    <Tabs
      value={section}
      onChange={(value) => value && onSectionChange(value as AnalyticsSection)}
      className="analytics-tabs"
    >
      <Box className="analytics-tabs-scroll-shell">
        <ScrollArea
          type="auto"
          scrollbars="x"
          offsetScrollbars="x"
          className="analytics-tabs-scroll"
          viewportProps={{ tabIndex: 0, role: "region", "aria-label": "Scrollable analytics sections" }}
        >
          <Tabs.List className="analytics-tabs-list">
            <Tabs.Tab value="usage" leftSection={<CoinsIcon size={15} />}>Usage</Tabs.Tab>
            <Tabs.Tab value="cost" leftSection={<CurrencyDollarIcon size={15} />}>Cost</Tabs.Tab>
            <Tabs.Tab value="tools" leftSection={<WrenchIcon size={15} />}>Tools</Tabs.Tab>
            <Tabs.Tab value="sessions" leftSection={<ListBulletsIcon size={15} />}>Session analytics</Tabs.Tab>
            <Tabs.Tab value="features" leftSection={<SparkleIcon size={15} />}>Features</Tabs.Tab>
          </Tabs.List>
        </ScrollArea>
      </Box>
      <Box className="analytics-summary">{summary}</Box>
      {firstUse ? <Tabs.Panel value={section} pt="sm"><CollectorSetup /></Tabs.Panel> : (
        <>
          <Tabs.Panel value="usage" pt="sm"><UsageAnalytics dashboard={data} /></Tabs.Panel>
          <Tabs.Panel value="cost" pt="sm"><CostAnalytics dashboard={data} /></Tabs.Panel>
          <Tabs.Panel value="tools" pt="sm"><ToolsAnalytics dashboard={data} /></Tabs.Panel>
          <Tabs.Panel value="sessions" pt="sm"><SessionsAnalytics dashboard={data} /></Tabs.Panel>
          <Tabs.Panel value="features" pt="sm"><FeaturesAnalytics dashboard={data} /></Tabs.Panel>
        </>
      )}
    </Tabs>
  )
}
