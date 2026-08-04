import { Box, ScrollArea, SimpleGrid, Stack } from "@mantine/core"
import { BarChart, BarsList, Heatmap } from "@mantine/charts"
import { ActivityIcon, CoinsIcon, SparkleIcon } from "@phosphor-icons/react"
import type { DashboardResponse } from "../../../shared/api"
import {
  ChartEmpty, ChartPanel, commonXAxisProps, commonYAxisProps, compactNumber, dailyChartData,
  formatDate, hasValues, integer, useTrackedChartTooltip
} from "./chartSupport"

function TokenComposition({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  const data = dailyChartData(daily)
  const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Token composition" detail="Input, output, and cache volume" className="analytics-primary-panel">
      {!hasValues(data, keys) ? (
        <ChartEmpty icon={<CoinsIcon />} title="No token data" detail="Token composition will appear when usage events are collected." />
      ) : (
        <Box className="analytics-chart-wrap" {...trackingProps}>
          <BarChart
            h={270}
            data={data}
            dataKey="label"
            type="stacked"
            series={[
              { name: "inputTokens", label: "Input", color: "var(--koliko-chart-cocoa)" },
              { name: "outputTokens", label: "Output", color: "var(--koliko-chart-sky)" },
              { name: "cacheReadTokens", label: "Cache read", color: "var(--koliko-chart-sage)" },
              { name: "cacheWriteTokens", label: "Cache write", color: "var(--koliko-chart-secondary)" }
            ]}
            valueFormatter={(value) => compactNumber.format(value)}
            withLegend
            maxBarWidth={14}
            fillOpacity={0.94}
            strokeDasharray="0"
            tickLine="none"
            gridAxis="y"
            xAxisProps={commonXAxisProps}
            yAxisProps={{ ...commonYAxisProps, tickFormatter: (value: number) => compactNumber.format(value) }}
            tooltipProps={tooltipProps}
            barProps={(series) => ({
              radius: series.name === "cacheWriteTokens" ? [3, 3, 0, 0] : 0,
              isAnimationActive: false
            })}
            legendProps={{ verticalAlign: "bottom", height: 52 }}
            className="analytics-chart"
            role="img"
            aria-label="Stacked daily token composition chart"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function ActivityHeatmap({
  daily,
  from,
  to
}: {
  readonly daily: DashboardResponse["daily"]
  readonly from: string
  readonly to: string
}) {
  const values = Object.fromEntries(daily.map((day) => [day.date, day.sessions]))
  const first = from || daily[0]?.date
  const last = to || daily.at(-1)?.date

  return (
    <ChartPanel title="Activity density" detail="Sessions per calendar day">
      {(!first || !last) ? (
        <ChartEmpty icon={<ActivityIcon />} title="No activity" detail="The activity heatmap will fill in as sessions arrive." />
      ) : (
        <ScrollArea type="auto" className="heatmap-scroll" offsetScrollbars>
          <Heatmap
            data={values}
            startDate={first}
            endDate={last}
            rectSize={22}
            gap={4}
            rectRadius={4}
            weekdaysLabelsWidth={38}
            withMonthLabels
            withWeekdayLabels
            withLegend
            withTooltip
            colors={[
              "var(--koliko-heat-1)",
              "var(--koliko-heat-2)",
              "var(--koliko-heat-3)",
              "var(--koliko-heat-4)"
            ]}
            getTooltipLabel={({ date, value }) => `${formatDate(date)} · ${integer.format(value ?? 0)} sessions`}
            tooltipProps={{ offset: 10 }}
            className="analytics-heatmap"
            role="img"
            aria-label="Daily session activity heatmap"
          />
        </ScrollArea>
      )}
    </ChartPanel>
  )
}

function ThinkingBreakdown({ rows }: { readonly rows: DashboardResponse["thinking"] }) {
  const total = rows.reduce((sum, row) => sum + row.tokens, 0)
  const data = rows
    .filter((row) => row.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)
    .map((row) => ({
      name: row.label,
      value: total === 0 ? 0 : row.tokens / total * 100,
      color: "var(--koliko-chart-cocoa)"
    }))

  return (
    <ChartPanel title="Thinking distribution" detail="Share of token volume">
      {data.length === 0 ? (
        <ChartEmpty icon={<SparkleIcon />} title="No thinking data" detail="Thinking-level distribution will appear when model usage includes a level." />
      ) : (
        <Box className="bars-list-wrap">
          <BarsList
            data={data}
            barsLabel="Level"
            valueLabel="Share"
            valueFormatter={(value) => `${value.toFixed(1)}%`}
            barHeight={28}
            barGap="xs"
            variant="filled"
            autoContrast
            barTextColor="var(--ds-panel-text)"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

export function UsageAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <TokenComposition daily={dashboard.daily} />
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
        <ActivityHeatmap daily={dashboard.daily} from={dashboard.from} to={dashboard.to} />
        <ThinkingBreakdown rows={dashboard.thinking} />
      </SimpleGrid>
    </Stack>
  )
}
