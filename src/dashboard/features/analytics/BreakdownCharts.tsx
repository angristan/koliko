import { Box, Center, ColorSwatch, Group, Stack, Text } from "@mantine/core"
import { BarsList, DonutChart } from "@mantine/charts"
import { CoinsIcon, DatabaseIcon } from "@phosphor-icons/react"
import type { DashboardResponse, UsageBreakdown } from "../../../shared/api"
import { ChartEmpty, ChartPanel, compactNumber, summaryMoney, useTrackedChartTooltip } from "./chartSupport"

const chartColors = [
  "var(--koliko-chart-teal)",
  "var(--koliko-chart-zinc)",
  "var(--koliko-chart-secondary)",
  "var(--koliko-chart-orange)",
  "var(--koliko-chart-walnut)"
] as const

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

export function ModelMix({ rows, valueKey = "tokens" }: { readonly rows: DashboardResponse["models"]; readonly valueKey?: BreakdownValue }) {
  const data = rankedBreakdown(rows, valueKey, 5)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const formatter = valueKey === "cost" ? (value: number) => summaryMoney.format(value) : (value: number) => compactNumber.format(value)
  const { trackingProps, tooltipProps } = useTrackedChartTooltip()

  return (
    <ChartPanel title="Model mix" detail={`${valueKey === "cost" ? "Spend" : "Token"} share by model`}>
      {data.length === 0 ? (
        <ChartEmpty icon={<CoinsIcon />} title="No model usage" detail="Model distribution will appear when usage is collected." />
      ) : (
        <Box className="donut-breakdown">
          <Center {...trackingProps}>
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
              tooltipProps={tooltipProps}
              className="analytics-chart donut-chart"
              role="img"
              aria-label={`Model distribution by ${valueKey}`}
            />
          </Center>
          <Stack gap={8} className="donut-breakdown-list">
            {data.map((item) => (
              <Group key={item.name} gap="xs" wrap="nowrap" justify="space-between">
                <Group gap="xs" wrap="nowrap" miw={0}>
                  <ColorSwatch color={chartCssColor(item.color)} size={9} />
                  <Text size="xs" className="breakdown-label" title={item.name}>{item.name}</Text>
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

export function RepositoryBars({ rows }: { readonly rows: DashboardResponse["repositories"] }) {
  const data = rows
    .filter((row) => row.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 8)
    .map((row) => ({ name: row.label, value: row.tokens, color: "var(--koliko-chart-zinc)" }))

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
            className="repository-bars"
            getBarProps={(item) => ({ title: item.name })}
            renderBar={(item, defaultBar) => <>{defaultBar}<Text size="xs" className="repository-full-label" aria-hidden="true">{item.name}</Text></>}
            barHeight={28}
            barGap="xs"
            variant="filled"
            autoContrast
            barTextColor="light-dark(var(--ds-paper), #21140f)"
          />
        </Box>
      )}
    </ChartPanel>
  )
}

export function RepositoryCostBars({ rows }: { readonly rows: DashboardResponse["repositories"] }) {
  const data = rows
    .filter((row) => row.cost > 0)
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 10)
    .map((row) => ({ name: row.label, value: row.cost, color: "var(--koliko-chart-orange)" }))

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
            className="repository-bars"
            getBarProps={(item) => ({ title: item.name })}
            renderBar={(item, defaultBar) => <>{defaultBar}<Text size="xs" className="repository-full-label" aria-hidden="true">{item.name}</Text></>}
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
