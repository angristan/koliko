import { Badge, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core"
import { BarChart } from "@mantine/charts"
import { SparkleIcon } from "@phosphor-icons/react"
import type { DashboardResponse } from "../../../shared/api"
import {
  ChartEmpty, ChartPanel, commonXAxisProps, dailyChartData, hasValues, integer, useTrackedChartTooltip
} from "./chartSupport"

function FeatureTrend({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  const data = dailyChartData(daily)
  const keys = ["compactions", "goals", "subagents"]
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Feature activity" detail="Lifecycle events by day" className="analytics-primary-panel">
      {!hasValues(data, keys) ? (
        <ChartEmpty icon={<SparkleIcon />} title="No feature events" detail="Compactions, goals, and delegation will appear as agents use them." />
      ) : (
        <Box className="analytics-chart-wrap" {...trackingProps}>
          <BarChart
            h={260}
            data={data}
            dataKey="label"
            type="stacked"
            series={[
              { name: "compactions", label: "Compactions", color: "var(--koliko-chart-secondary)" },
              { name: "goals", label: "Goals", color: "var(--koliko-chart-orange)" },
              { name: "subagents", label: "Sub-agents", color: "var(--koliko-chart-sky)" }
            ]}
            withLegend
            maxBarWidth={20}
            strokeDasharray="0"
            tickLine="none"
            gridAxis="y"
            xAxisProps={commonXAxisProps}
            yAxisProps={{ width: 36, allowDecimals: false }}
            tooltipProps={tooltipProps}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
            role="img"
            aria-label="Daily feature lifecycle stacked bar chart"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function FeatureBreakdown({ features }: { readonly features: DashboardResponse["features"] }) {
  return (
    <ChartPanel title="Lifecycle breakdown" detail="Observed feature states">
      {features.length === 0 ? (
        <ChartEmpty icon={<SparkleIcon />} title="No lifecycle events" detail="Feature event states will appear when agents report them." />
      ) : (
        <Stack gap={0} className="analytics-feature-list">
          {features.map((feature) => (
            <Group justify="space-between" wrap="nowrap" className="feature-row" key={`${feature.feature}-${feature.label}`}>
              <Group wrap="nowrap" miw={0}>
                <ThemeIcon variant="light" color={feature.feature === "goal" ? "honey" : feature.feature === "subagent" ? "sky" : "sage"} radius="md">
                  <SparkleIcon />
                </ThemeIcon>
                <Box miw={0}>
                  <Text size="sm" fw={600} tt="capitalize" truncate>{feature.label.replaceAll("_", " ")}</Text>
                  <Text size="xs" c="dimmed" truncate>{feature.feature} · {feature.detail}</Text>
                </Box>
              </Group>
              <Badge variant="light" color="sage">{integer.format(feature.count)}</Badge>
            </Group>
          ))}
        </Stack>
      )}
    </ChartPanel>
  )
}

export function FeaturesAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <FeatureTrend daily={dashboard.daily} />
      <FeatureBreakdown features={dashboard.features} />
    </Stack>
  )
}
