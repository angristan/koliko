import { Box, SimpleGrid, Stack } from "@mantine/core"
import { CompositeChart } from "@mantine/charts"
import { CurrencyDollarIcon } from "@phosphor-icons/react"
import type { DashboardResponse } from "../../../shared/api"
import { ModelMix, RepositoryCostBars } from "./BreakdownCharts"
import {
  ChartEmpty, ChartPanel, commonXAxisProps, commonYAxisProps, dailyChartData, hasValues,
  summaryMoney, useTrackedChartTooltip
} from "./chartSupport"

function CostTrend({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  let cumulative = 0
  const data = dailyChartData(daily).map((day) => {
    cumulative += day.cost
    return { label: day.label, dailyCost: day.cost, cumulativeCost: cumulative }
  })
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Cost trajectory" detail={`Cumulative ${summaryMoney.format(cumulative)}`} className="analytics-primary-panel">
      {!hasValues(data, ["dailyCost"]) ? (
        <ChartEmpty icon={<CurrencyDollarIcon />} title="No cost data" detail="Provider-reported cost will appear when usage events include pricing." />
      ) : (
        <Box className="analytics-chart-wrap" {...trackingProps}>
          <CompositeChart
            h={270}
            data={data}
            dataKey="label"
            series={[
              { name: "dailyCost", label: "Daily", color: "var(--koliko-chart-orange)", type: "bar", yAxisId: "left" },
              { name: "cumulativeCost", label: "Cumulative", color: "var(--koliko-chart-sky)", type: "line", yAxisId: "right" }
            ]}
            withLegend
            withRightYAxis
            withDots={false}
            maxBarWidth={14}
            strokeWidth={2}
            strokeDasharray="0"
            tickLine="none"
            gridAxis="y"
            valueFormatter={(value) => summaryMoney.format(value)}
            xAxisProps={commonXAxisProps}
            yAxisProps={{ ...commonYAxisProps, yAxisId: "left", tickFormatter: (value: number) => summaryMoney.format(value) }}
            rightYAxisProps={{ width: 54, yAxisId: "right", tickFormatter: (value: number) => summaryMoney.format(value) }}
            tooltipProps={tooltipProps}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            lineProps={{ isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
            role="img"
            aria-label="Daily cost bars with cumulative cost line"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

export function CostAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <CostTrend daily={dashboard.daily} />
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
        <ModelMix rows={dashboard.models} valueKey="cost" />
        <RepositoryCostBars rows={dashboard.repositories} />
      </SimpleGrid>
    </Stack>
  )
}
