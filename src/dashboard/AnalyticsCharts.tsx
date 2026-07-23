import { useState, type ReactNode } from "react"
import {
  Badge,
  Box,
  Center,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon
} from "@mantine/core"
import {
  BarChart,
  BarsList,
  BubbleChart,
  CompositeChart,
  DonutChart,
  Heatmap,
  getFilteredChartTooltipPayload
} from "@mantine/charts"
import {
  ActivityIcon,
  ChartLineUpIcon,
  CoinsIcon,
  CurrencyDollarIcon,
  DatabaseIcon,
  ListBulletsIcon,
  SparkleIcon,
  WrenchIcon
} from "@phosphor-icons/react"
import type { TooltipContentProps } from "recharts"
import { DashboardResponse, SummaryMetrics, type DailyMetric, type UsageBreakdown } from "../shared/api"

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en")
const summaryMoney = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

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

const chartColors = [
  "var(--koliko-chart-sand)",
  "var(--koliko-chart-accent)",
  "var(--koliko-chart-gold)",
  "var(--koliko-chart-ochre)",
  "var(--koliko-chart-caramel)",
  "var(--koliko-chart-taupe)"
] as const

const formatDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
})

const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  const totalMinutes = Math.round(milliseconds / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

function ChartPanel({
  title,
  detail,
  control,
  children,
  className = ""
}: {
  readonly title: string
  readonly detail?: string
  readonly control?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <Paper withBorder radius="md" className={`panel analytics-panel ${className}`.trim()}>
      <Group justify="space-between" gap="sm" className="panel-header analytics-panel-header" wrap="nowrap">
        <Box miw={0}>
          <Text fw={600} className="panel-title" truncate>{title}</Text>
          {detail && <Text size="xs" c="dimmed" mt={1} truncate>{detail}</Text>}
        </Box>
        {control}
      </Group>
      <Divider />
      <Box className="panel-body">{children}</Box>
    </Paper>
  )
}

function ChartEmpty({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return (
    <Center className="chart-empty">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon size={38} radius="xl" variant="light" color="gray">{icon}</ThemeIcon>
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed" maw={340}>{detail}</Text>
      </Stack>
    </Center>
  )
}

const hasValues = (data: ReadonlyArray<Record<string, unknown>>, keys: ReadonlyArray<string>): boolean =>
  data.some((row) => keys.some((key) => typeof row[key] === "number" && row[key] > 0))

const dailyChartData = (daily: ReadonlyArray<DailyMetric>) => daily.map((day) => ({
  ...day,
  label: formatDate(day.date)
}))

type BreakdownValue = "tokens" | "cost" | "sessions" | "turns"

const rankedBreakdown = (
  rows: ReadonlyArray<UsageBreakdown>,
  valueKey: BreakdownValue,
  limit = 6
): Array<{ name: string; value: number; color: string }> => {
  const ranked = rows
    .filter((row) => row[valueKey] > 0)
    .sort((left, right) => right[valueKey] - left[valueKey])
  const visible: Array<{ name: string; value: number; color: string }> = ranked.slice(0, Math.max(1, limit - 1)).map((row, index) => ({
    name: row.label,
    value: row[valueKey],
    color: chartColors[index % chartColors.length]
  }))
  const remainder = ranked.slice(Math.max(1, limit - 1)).reduce((sum, row) => sum + row[valueKey], 0)
  if (remainder > 0) visible.push({ name: "Other", value: remainder, color: "gray.5" })
  return visible
}

const chartCssColor = (color: string): string => color.startsWith("var(")
  ? color
  : `var(--mantine-color-${color.replace(".", "-")})`

const commonXAxisProps = { minTickGap: 28, tickMargin: 10 }
const commonYAxisProps = { width: 48 }
const commonTooltipProps = { offset: 16 }

const trendMetrics = {
  tokens: {
    label: "Tokens",
    detail: "Daily token volume",
    key: "tokens",
    color: "var(--koliko-chart-sand)",
    type: "bar",
    format: (value: number) => compactNumber.format(value)
  },
  cost: {
    label: "Cost",
    detail: "Provider-reported spend",
    key: "cost",
    color: "var(--koliko-chart-accent)",
    type: "area",
    format: (value: number) => summaryMoney.format(value)
  },
  sessions: {
    label: "Sessions",
    detail: "Distinct daily runs",
    key: "sessions",
    color: "var(--koliko-chart-gold)",
    type: "bar",
    format: (value: number) => integer.format(value)
  },
  runtime: {
    label: "Agent time",
    detail: "Tracked active runtime",
    key: "trackedMs",
    color: "var(--koliko-chart-taupe)",
    type: "area",
    format: formatDuration
  }
} as const

type TrendMetric = keyof typeof trendMetrics

function TrendExplorer({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  const [metric, setMetric] = useState<TrendMetric>("tokens")
  const config = trendMetrics[metric]
  const data = dailyChartData(daily).map((day) => ({ label: day.label, value: day[config.key] }))
  const total = data.reduce((sum, day) => sum + day.value, 0)

  return (
    <ChartPanel
      title="Trend explorer"
      detail={`${config.detail} · ${config.format(total)} total`}
      className="analytics-primary-panel"
      control={
        <SegmentedControl
          size="xs"
          value={metric}
          onChange={(value) => setMetric(value as TrendMetric)}
          data={Object.entries(trendMetrics).map(([value, item]) => ({ value, label: item.label }))}
          className="chart-segmented"
        />
      }
    >
      {!hasValues(data, ["value"]) ? (
        <ChartEmpty icon={<ChartLineUpIcon />} title="No trend data" detail="Usage trends will appear after your collector sends events." />
      ) : (
        <Box className="analytics-chart-wrap">
          <CompositeChart
            h={230}
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
            tooltipProps={commonTooltipProps}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            areaProps={{ fillOpacity: 0.16, isAnimationActive: false }}
            lineProps={{ isAnimationActive: false }}
            className="analytics-chart"
            aria-label={`${config.label} trend chart`}
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function ModelMix({ rows, valueKey = "tokens" }: { readonly rows: DashboardResponse["models"]; readonly valueKey?: BreakdownValue }) {
  const data = rankedBreakdown(rows, valueKey, 5)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const formatter = valueKey === "cost" ? (value: number) => summaryMoney.format(value) : (value: number) => compactNumber.format(value)

  return (
    <ChartPanel title="Model mix" detail={`${valueKey === "cost" ? "Spend" : "Token"} share by model`}>
      {data.length === 0 ? (
        <ChartEmpty icon={<CoinsIcon />} title="No model usage" detail="Model distribution will appear when usage is collected." />
      ) : (
        <Box className="donut-breakdown">
          <Center>
            <DonutChart
              data={data}
              size={144}
              thickness={22}
              paddingAngle={2}
              strokeWidth={2}
              strokeColor="var(--koliko-surface)"
              chartLabel={formatter(total)}
              tooltipDataSource="segment"
              valueFormatter={formatter}
              pieProps={{ isAnimationActive: false }}
              tooltipProps={commonTooltipProps}
              className="analytics-chart donut-chart"
              aria-label={`Model distribution by ${valueKey}`}
            />
          </Center>
          <Stack gap={8} className="donut-breakdown-list">
            {data.map((item) => (
              <Group key={item.name} gap="xs" wrap="nowrap" justify="space-between">
                <Group gap="xs" wrap="nowrap" miw={0}>
                  <ColorSwatch color={chartCssColor(item.color)} size={9} />
                  <Text size="xs" truncate>{item.name}</Text>
                </Group>
                <Text size="xs" fw={600} className="tabular-value">
                  {total === 0 ? "0%" : `${(item.value / total * 100).toFixed(1)}%`}
                </Text>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
    </ChartPanel>
  )
}

function RepositoryBars({ rows }: { readonly rows: DashboardResponse["repositories"] }) {
  const data = rows
    .filter((row) => row.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 8)
    .map((row) => ({ name: row.label, value: row.tokens, color: "var(--koliko-chart-sand)" }))

  return (
    <ChartPanel title="Repository volume" detail="Top folders by tokens">
      {data.length === 0 ? (
        <ChartEmpty icon={<DatabaseIcon />} title="No repository usage" detail="Folder-level distribution will appear after sessions are collected." />
      ) : (
        <Box className="bars-list-wrap">
          <BarsList
            data={data}
            barsLabel="Repository"
            valueLabel="Tokens"
            valueFormatter={(value) => compactNumber.format(value)}
            barHeight={28}
            barGap="xs"
            variant="filled"
            autoContrast
          />
        </Box>
      )}
    </ChartPanel>
  )
}

export function OverviewCharts({ dashboard }: { readonly dashboard: DashboardResponse | undefined }) {
  const data = dashboard
  return (
    <Stack gap="sm">
      <TrendExplorer daily={data?.daily ?? []} />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <ModelMix rows={data?.models ?? []} />
        <RepositoryBars rows={data?.repositories ?? []} />
      </SimpleGrid>
    </Stack>
  )
}

function TokenComposition({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  const data = dailyChartData(daily)
  const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]

  return (
    <ChartPanel title="Token composition" detail="Input, output, and cache volume" className="analytics-primary-panel">
      {!hasValues(data, keys) ? (
        <ChartEmpty icon={<CoinsIcon />} title="No token data" detail="Token composition will appear when usage events are collected." />
      ) : (
        <Box className="analytics-chart-wrap">
          <BarChart
            h={270}
            data={data}
            dataKey="label"
            type="stacked"
            series={[
              { name: "inputTokens", label: "Input", color: "var(--koliko-chart-sand)" },
              { name: "outputTokens", label: "Output", color: "var(--koliko-chart-accent)" },
              { name: "cacheReadTokens", label: "Cache read", color: "var(--koliko-chart-gold)" },
              { name: "cacheWriteTokens", label: "Cache write", color: "var(--koliko-chart-taupe)" }
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
            tooltipProps={commonTooltipProps}
            barProps={(series) => ({
              radius: series.name === "cacheWriteTokens" ? [3, 3, 0, 0] : 0,
              isAnimationActive: false
            })}
            legendProps={{ verticalAlign: "bottom", height: 52 }}
            className="analytics-chart"
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
      color: "var(--koliko-chart-caramel)"
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
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function CostTrend({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  let cumulative = 0
  const data = dailyChartData(daily).map((day) => {
    cumulative += day.cost
    return { label: day.label, dailyCost: day.cost, cumulativeCost: cumulative }
  })

  return (
    <ChartPanel title="Cost trajectory" detail={`Cumulative ${summaryMoney.format(cumulative)}`} className="analytics-primary-panel">
      {!hasValues(data, ["dailyCost"]) ? (
        <ChartEmpty icon={<CurrencyDollarIcon />} title="No cost data" detail="Provider-reported cost will appear when usage events include pricing." />
      ) : (
        <Box className="analytics-chart-wrap">
          <CompositeChart
            h={270}
            data={data}
            dataKey="label"
            series={[
              { name: "dailyCost", label: "Daily", color: "var(--koliko-chart-sand)", type: "bar", yAxisId: "left" },
              { name: "cumulativeCost", label: "Cumulative", color: "var(--koliko-chart-accent)", type: "line", yAxisId: "right" }
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
            tooltipProps={commonTooltipProps}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            lineProps={{ isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
            aria-label="Daily cost bars with cumulative cost line"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function RepositoryCostBars({ rows }: { readonly rows: DashboardResponse["repositories"] }) {
  const data = rows
    .filter((row) => row.cost > 0)
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 10)
    .map((row) => ({ name: row.label, value: row.cost, color: "var(--koliko-chart-sand)" }))

  return (
    <ChartPanel title="Repository spend" detail="Highest-cost folders">
      {data.length === 0 ? (
        <ChartEmpty icon={<DatabaseIcon />} title="No repository cost" detail="Repository cost allocation will appear when priced usage is available." />
      ) : (
        <Box className="bars-list-wrap">
          <BarsList
            data={data}
            barsLabel="Repository"
            valueLabel="Cost"
            valueFormatter={(value) => summaryMoney.format(value)}
            barHeight={28}
            barGap="xs"
            variant="filled"
            autoContrast
          />
        </Box>
      )}
    </ChartPanel>
  )
}

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

  return (
    <ChartPanel title="Tool reliability" detail="Call volume and error rate" className="analytics-primary-panel">
      {data.length === 0 ? (
        <ChartEmpty icon={<WrenchIcon />} title="No tool calls" detail="Tool reliability will appear when agent runs execute tools." />
      ) : (
        <Box className="analytics-chart-wrap">
          <CompositeChart
            h={280}
            data={data}
            dataKey="tool"
            series={[
              { name: "Calls", color: "var(--koliko-chart-ochre)", type: "bar", yAxisId: "left" },
              { name: "Error %", label: "Error rate", color: "red.6", type: "line", yAxisId: "right" }
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
            tooltipProps={{ ...commonTooltipProps, content: (props) => <ToolPerformanceTooltip {...props} /> }}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            lineProps={{ isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
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
    .map((tool) => ({ ...tool, color: "var(--koliko-chart-caramel)" }))

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
          />
        </Box>
      )}
    </ChartPanel>
  )
}

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

  return (
    <ChartPanel title="Session efficiency" detail="Tokens × runtime · bubble size is cost" className="analytics-primary-panel">
      {data.length === 0 ? (
        <ChartEmpty icon={<ListBulletsIcon />} title="No session metrics" detail="Session relationships will appear after complete runs are collected." />
      ) : (
        <Box className="analytics-chart-wrap bubble-chart-wrap">
          <BubbleChart
            h={320}
            data={data}
            dataKey={{ x: "tokens", y: "runtimeMinutes", z: "cost" }}
            range={[28, 240]}
            color="var(--koliko-chart-taupe)"
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
            tooltipProps={{ ...commonTooltipProps, content: (props) => <SessionBubbleTooltip {...props} /> }}
            scatterProps={{ isAnimationActive: false, fillOpacity: 0.78, stroke: "var(--koliko-chart-caramel)", strokeWidth: 1 }}
            className="analytics-chart"
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
      color: "var(--koliko-chart-sand)"
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
          />
        </Box>
      )}
    </ChartPanel>
  )
}

function FeatureTrend({ daily }: { readonly daily: DashboardResponse["daily"] }) {
  const data = dailyChartData(daily)
  const keys = ["compactions", "goals", "subagents"]

  return (
    <ChartPanel title="Feature activity" detail="Lifecycle events by day" className="analytics-primary-panel">
      {!hasValues(data, keys) ? (
        <ChartEmpty icon={<SparkleIcon />} title="No feature events" detail="Compactions, goals, and delegation will appear as agents use them." />
      ) : (
        <Box className="analytics-chart-wrap">
          <BarChart
            h={260}
            data={data}
            dataKey="label"
            type="stacked"
            series={[
              { name: "compactions", label: "Compactions", color: "var(--koliko-chart-gold)" },
              { name: "goals", label: "Goals", color: "var(--koliko-chart-accent)" },
              { name: "subagents", label: "Sub-agents", color: "var(--koliko-chart-taupe)" }
            ]}
            withLegend
            maxBarWidth={20}
            strokeDasharray="0"
            tickLine="none"
            gridAxis="y"
            xAxisProps={commonXAxisProps}
            yAxisProps={{ width: 36, allowDecimals: false }}
            tooltipProps={commonTooltipProps}
            barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
            legendProps={{ verticalAlign: "bottom", height: 34 }}
            className="analytics-chart"
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
                <ThemeIcon variant="light" color={feature.feature === "goal" ? "tangerine" : feature.feature === "subagent" ? "yellow" : "orange"} radius="md">
                  <SparkleIcon />
                </ThemeIcon>
                <Box miw={0}>
                  <Text size="sm" fw={600} tt="capitalize" truncate>{feature.label.replaceAll("_", " ")}</Text>
                  <Text size="xs" c="dimmed" truncate>{feature.feature} · {feature.detail}</Text>
                </Box>
              </Group>
              <Badge variant="light" color="gray">{integer.format(feature.count)}</Badge>
            </Group>
          ))}
        </Stack>
      )}
    </ChartPanel>
  )
}

function UsageAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
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

function CostAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
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

function ToolsAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <ToolPerformance tools={dashboard.tools} />
      <ToolDurationBars tools={dashboard.tools} />
    </Stack>
  )
}

function SessionsAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <SessionBubble sessions={dashboard.sessions} />
      <SessionCostBars sessions={dashboard.sessions} />
    </Stack>
  )
}

function FeaturesAnalytics({ dashboard }: { readonly dashboard: DashboardResponse }) {
  return (
    <Stack gap="sm">
      <FeatureTrend daily={dashboard.daily} />
      <FeatureBreakdown features={dashboard.features} />
    </Stack>
  )
}

export function AnalyticsWorkspace({ dashboard }: { readonly dashboard: DashboardResponse | undefined }) {
  const data = dashboard ?? EMPTY_DASHBOARD

  return (
    <Tabs defaultValue="usage" variant="outline" className="analytics-tabs">
      <ScrollArea type="never" offsetScrollbars>
        <Tabs.List className="analytics-tabs-list">
          <Tabs.Tab value="usage" leftSection={<CoinsIcon size={15} />}>Usage</Tabs.Tab>
          <Tabs.Tab value="cost" leftSection={<CurrencyDollarIcon size={15} />}>Cost</Tabs.Tab>
          <Tabs.Tab value="tools" leftSection={<WrenchIcon size={15} />}>Tools</Tabs.Tab>
          <Tabs.Tab value="sessions" leftSection={<ListBulletsIcon size={15} />}>Sessions</Tabs.Tab>
          <Tabs.Tab value="features" leftSection={<SparkleIcon size={15} />}>Features</Tabs.Tab>
        </Tabs.List>
      </ScrollArea>
      <Tabs.Panel value="usage" pt="sm"><UsageAnalytics dashboard={data} /></Tabs.Panel>
      <Tabs.Panel value="cost" pt="sm"><CostAnalytics dashboard={data} /></Tabs.Panel>
      <Tabs.Panel value="tools" pt="sm"><ToolsAnalytics dashboard={data} /></Tabs.Panel>
      <Tabs.Panel value="sessions" pt="sm"><SessionsAnalytics dashboard={data} /></Tabs.Panel>
      <Tabs.Panel value="features" pt="sm"><FeaturesAnalytics dashboard={data} /></Tabs.Panel>
    </Tabs>
  )
}
