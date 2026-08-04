import { Box, ColorSwatch, Group, Paper, Stack, Text } from "@mantine/core"
import { BarsList, CompositeChart, getFilteredChartTooltipPayload } from "@mantine/charts"
import { WrenchIcon } from "@phosphor-icons/react"
import type { TooltipContentProps } from "recharts"
import type { DashboardResponse } from "../../../shared/api"
import {
  ChartEmpty, ChartPanel, compactNumber, formatDuration, integer, useTrackedChartTooltip
} from "./chartSupport"

function ToolPerformanceTooltip({ active, label, payload }: TooltipContentProps<number, string>) {
  const items = getFilteredChartTooltipPayload(payload ?? [])
  if (!active || items.length === 0) return null

  return (
    <Paper withBorder radius="md" p="xs" className="bubble-tooltip">
      <Text size="xs" fw={600} mb={5}>{label}</Text>
      <Stack gap={4}>
        {items.map((item) => {
          const isErrorRate = item.dataKey === "Error %"
          return (
            <Group key={String(item.dataKey)} gap="xs" justify="space-between" wrap="nowrap">
              <Group gap={6} wrap="nowrap">
                <ColorSwatch color={String(item.color)} size={8} />
                <Text size="xs" c="dimmed">{String(item.name)}</Text>
              </Group>
              <Text size="xs" fw={600}>{isErrorRate ? `${Number(item.value).toFixed(1)}%` : integer.format(Number(item.value))}</Text>
            </Group>
          )
        })}
      </Stack>
    </Paper>
  )
}

function ToolPerformance({ tools }: { readonly tools: DashboardResponse["tools"] }) {
  const data = tools
    .filter((tool) => tool.calls > 0)
    .sort((left, right) => right.calls - left.calls)
    .slice(0, 10)
    .map((tool) => ({
      tool: tool.name.length > 13 ? `${tool.name.slice(0, 12)}…` : tool.name,
      Calls: tool.calls,
      "Error %": tool.errors / tool.calls * 100
    }))
  const errorCeiling = Math.max(2, Math.ceil(Math.max(...data.map((tool) => tool["Error %"]), 0)))
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Tool reliability" detail="Call volume and error rate" className="analytics-primary-panel">
      {data.length === 0 ? (
        <ChartEmpty icon={<WrenchIcon />} title="No tool calls" detail="Tool reliability will appear when agent runs execute tools." />
      ) : (
        <Box className="analytics-chart-wrap" {...trackingProps}>
          <CompositeChart
            h={280}
            data={data}
            dataKey="tool"
            series={[
              { name: "Calls", color: "var(--koliko-chart-sage)", type: "bar", yAxisId: "left" },
              { name: "Error %", label: "Error rate", color: "rust.6", type: "line", yAxisId: "right" }
            ]}
            withLegend
            withRightYAxis
            withDots
            maxBarWidth={24}
            strokeWidth={2}
            strokeDasharray="0"
            tickLine="none"
            gridAxis="y"
            valueFormatter={(value) => compactNumber.format(value)}
            xAxisProps={{ minTickGap: 12, tickMargin: 10 }}
            yAxisProps={{ width: 44, yAxisId: "left", allowDecimals: false }}
            rightYAxisProps={{ width: 46, yAxisId: "right", domain: [0, errorCeiling], tickFormatter: (value: number) => `${value}%` }}
            tooltipProps={{ ...tooltipProps, content: (props) => <ToolPerformanceTooltip {...props} /> }}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            lineProps={{ isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
            role="img"
            aria-label="Tool call volume and error rate composite chart"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function ToolDurationBars({ tools }: { readonly tools: DashboardResponse["tools"] }) {
  const data = tools
    .filter((tool) => tool.calls > 0 && tool.durationMs > 0)
    .map((tool) => ({ name: tool.name, value: tool.durationMs / tool.calls }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 10)
    .map((tool) => ({ ...tool, color: "var(--koliko-chart-cocoa)" }))

  return (
    <ChartPanel title="Average tool duration" detail="Slowest tools per call">
      {data.length === 0 ? (
        <ChartEmpty icon={<WrenchIcon />} title="No duration data" detail="Tool timing will appear when execution duration is reported." />
      ) : (
        <Box className="bars-list-wrap">
          <BarsList
            data={data}
            barsLabel="Tool"
            valueLabel="Average"
            valueFormatter={formatDuration}
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

export function ToolsAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <ToolPerformance tools={dashboard.tools} />
      <ToolDurationBars tools={dashboard.tools} />
    </Stack>
  )
}
