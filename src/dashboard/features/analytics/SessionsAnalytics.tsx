import { Box, Paper, Stack, Text } from "@mantine/core"
import { BarsList, BubbleChart } from "@mantine/charts"
import { CurrencyDollarIcon, ListBulletsIcon } from "@phosphor-icons/react"
import type { TooltipContentProps } from "recharts"
import type { DashboardResponse } from "../../../shared/api"
import { ChartEmpty, ChartPanel, compactNumber, summaryMoney, useTrackedChartTooltip } from "./chartSupport"

function SessionBubbleTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const row = payload?.[0]?.payload as {
    tokens?: number
    runtimeMinutes?: number
    cost?: number
    repository?: string
    endedAt?: string
  } | undefined
  if (!active || !row) return null

  return (
    <Paper withBorder radius="md" p="xs" className="bubble-tooltip">
      <Text size="xs" fw={600} truncate maw={220}>{row.repository ?? "Session"}</Text>
      <Text size="xs" c="dimmed" mt={2}>
        {compactNumber.format(row.tokens ?? 0)} tokens · {compactNumber.format(row.runtimeMinutes ?? 0)} min
      </Text>
      <Text size="xs" c="dimmed" mt={2}>
        {summaryMoney.format(row.cost ?? 0)}{row.endedAt ? ` · ${new Date(row.endedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}` : ""}
      </Text>
    </Paper>
  )
}

function SessionBubble({ sessions }: { readonly sessions: DashboardResponse["sessions"] }) {
  const data = sessions
    .filter((session) => session.tokens > 0 && session.trackedMs > 0)
    .map((session) => ({
      tokens: session.tokens,
      runtimeMinutes: session.trackedMs / 60_000,
      cost: Math.max(session.cost, 0.0001),
      repository: session.repository,
      endedAt: session.endedAt
    }))
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Session efficiency" detail="Tokens × runtime · bubble size is cost" className="analytics-primary-panel">
      {data.length === 0 ? (
        <ChartEmpty icon={<ListBulletsIcon />} title="No session metrics" detail="Session relationships will appear after complete runs are collected." />
      ) : (
        <Box className="analytics-chart-wrap bubble-chart-wrap" {...trackingProps}>
          <BubbleChart
            h={320}
            data={data}
            dataKey={{ x: "tokens", y: "runtimeMinutes", z: "cost" }}
            range={[28, 240]}
            color="var(--koliko-chart-sky)"
            valueFormatter={(value) => summaryMoney.format(value)}
            xAxisProps={{
              type: "number",
              name: "Tokens",
              domain: [0, "auto"],
              height: 48,
              tickCount: 6,
              tickFormatter: (value: number) => compactNumber.format(value),
              label: { value: "Tokens", position: "insideBottom", offset: -4 }
            }}
            yAxisProps={{
              type: "number",
              name: "Runtime",
              domain: [0, "auto"],
              width: 62,
              tick: true,
              tickLine: false,
              axisLine: false,
              tickCount: 5,
              tickFormatter: (value: number) => compactNumber.format(value),
              label: { value: "Runtime (min)", angle: -90, position: "insideLeft" }
            }}
            zAxisProps={{ name: "Cost" }}
            tooltipProps={{ ...tooltipProps, content: (props) => <SessionBubbleTooltip {...props} /> }}
            scatterProps={{ isAnimationActive: false, fillOpacity: 0.78, stroke: "var(--koliko-chart-cocoa)", strokeWidth: 1 }}
            className="analytics-chart"
            role="img"
            aria-label="Session token, runtime, and cost bubble chart"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function SessionCostBars({ sessions }: { readonly sessions: DashboardResponse["sessions"] }) {
  const data = sessions
    .filter((session) => session.cost > 0)
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 10)
    .map((session) => ({
      name: `${session.repository} · ${new Date(session.endedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}`,
      value: session.cost,
      color: "var(--koliko-chart-orange)"
    }))

  return (
    <ChartPanel title="Highest-cost sessions" detail="Top recent runs">
      {data.length === 0 ? (
        <ChartEmpty icon={<CurrencyDollarIcon />} title="No session cost" detail="Cost ranking will appear when sessions include priced usage." />
      ) : (
        <Box className="bars-list-wrap">
          <BarsList
            data={data}
            barsLabel="Session"
            valueLabel="Cost"
            valueFormatter={(value) => summaryMoney.format(value)}
            barHeight={28}
            barGap="xs"
            variant="filled"
            autoContrast
            barTextColor="var(--ds-on-accent)"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

export function SessionsAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <SessionBubble sessions={dashboard.sessions} />
      <SessionCostBars sessions={dashboard.sessions} />
    </Stack>
  )
}
