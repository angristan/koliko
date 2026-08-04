import { Box, ScrollArea, SegmentedControl, SimpleGrid, Stack, Table } from "@mantine/core"
import { CompositeChart } from "@mantine/charts"
import { ChartLineUpIcon } from "@phosphor-icons/react"
import type { DashboardResponse } from "../../../shared/api"
import type { TrendMetric } from "../../navigation"
import { hasCollectedData } from "../../presentation"
import { ModelMix, RepositoryBars } from "../analytics/BreakdownCharts"
import {
  ChartEmpty, ChartPanel, CollectorSetup, commonXAxisProps, commonYAxisProps, compactNumber,
  dailyChartData, formatDuration, formatLongDate, hasValues, integer, summaryMoney, useTrackedChartTooltip
} from "../analytics/chartSupport"

const trendMetrics = {
  tokens: {
    label: "Tokens",
    detail: "Daily token volume",
    key: "tokens",
    color: "var(--koliko-chart-teal)",
    type: "bar",
    format: (value: number) => compactNumber.format(value)
  },
  cost: {
    label: "Cost",
    detail: "Provider-reported spend",
    key: "cost",
    color: "var(--koliko-chart-orange)",
    type: "area",
    format: (value: number) => summaryMoney.format(value)
  },
  sessions: {
    label: "Sessions",
    detail: "Distinct daily runs",
    key: "sessions",
    color: "var(--koliko-chart-sage)",
    type: "bar",
    format: (value: number) => integer.format(value)
  },
  runtime: {
    label: "Agent time",
    detail: "Tracked active runtime",
    key: "trackedMs",
    color: "var(--koliko-chart-cocoa)",
    type: "area",
    format: formatDuration
  }
} as const

function TrendExplorer({ daily, metric, onMetricChange }: {
  readonly daily: DashboardResponse["daily"]
  readonly metric: TrendMetric
  readonly onMetricChange: (metric: TrendMetric) => void
}) {
  const config = trendMetrics[metric]
  const data = dailyChartData(daily).map((day) => ({ date: day.date, label: day.label, value: day[config.key] }))
  const total = data.reduce((sum, day) => sum + day.value, 0)
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel
      title="Trend explorer"
      detail={`${config.detail} · ${config.format(total)} total`}
      className="analytics-primary-panel"
      control={
        <SegmentedControl
          size="xs"
          value={metric}
          onChange={(value) => onMetricChange(value as TrendMetric)}
          data={Object.entries(trendMetrics).map(([value, item]) => ({ value, label: item.label }))}
          className="chart-segmented"
        />
      }
    >
      {!hasValues(data, ["value"]) ? (
        <ChartEmpty icon={<ChartLineUpIcon />} title="No trend data" detail="Usage trends will appear after your collector sends events." />
      ) : (
        <>
          <Box className="analytics-chart-wrap" {...trackingProps}>
            <CompositeChart
              h={270}
              data={data}
              dataKey="label"
              series={[{ name: "value", label: config.label, color: config.color, type: config.type }]}
              valueFormatter={config.format}
              maxBarWidth={18}
              strokeWidth={2}
              strokeDasharray="0"
              tickLine="none"
              gridAxis="y"
              withDots={false}
              xAxisProps={commonXAxisProps}
              yAxisProps={{ ...commonYAxisProps, tickFormatter: config.format }}
              tooltipProps={tooltipProps}
              barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
              areaProps={{ fillOpacity: 0.16, isAnimationActive: false }}
              lineProps={{ isAnimationActive: false }}
              className="analytics-chart"
              role="img"
              aria-label={`${config.label} trend chart`}
            />
          </Box>
          <details className="chart-data-view">
            <summary>View dates and values</summary>
            <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
              <Table verticalSpacing="xs" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr><Table.Th>Date</Table.Th><Table.Th ta="right">{config.label}</Table.Th></Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.map((day) => (
                    <Table.Tr key={day.date}>
                      <Table.Td>{formatLongDate(day.date)}</Table.Td>
                      <Table.Td ta="right" className="tabular-value">{config.format(day.value)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </details>
        </>
      )}
    </ChartPanel>
  )
}

export function OverviewCharts({ dashboard, metric, onMetricChange }: {
  readonly dashboard: DashboardResponse | undefined
  readonly metric: TrendMetric
  readonly onMetricChange: (metric: TrendMetric) => void
}) {
  const data = dashboard
  if (data && !hasCollectedData(data.summary)) return <CollectorSetup />

  return (
    <Stack gap="sm">
      <TrendExplorer daily={data?.daily ?? []} metric={metric} onMetricChange={onMetricChange} />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <ModelMix rows={data?.models ?? []} />
        <RepositoryBars rows={data?.repositories ?? []} />
      </SimpleGrid>
    </Stack>
  )
}
