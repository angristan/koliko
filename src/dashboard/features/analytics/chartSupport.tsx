import { useRef, useState, type PointerEvent, type ReactNode } from "react"
import { Box, Button, Center, Divider, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core"
import { ActivityIcon } from "@phosphor-icons/react"
import type { DailyMetric } from "../../../shared/api"

export const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
export const integer = new Intl.NumberFormat("en")
export const summaryMoney = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export const formatDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
})

export const formatLongDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC"
})

export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  const totalMinutes = Math.round(milliseconds / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

export function ChartPanel({
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

export function ChartEmpty({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return (
    <Center className="chart-empty">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon size={38} radius="md" variant="light" color="sky">{icon}</ThemeIcon>
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed" maw={340}>{detail}</Text>
      </Stack>
    </Center>
  )
}

export function CollectorSetup() {
  return (
    <ChartPanel title="Collector setup" detail="First use" className="collector-setup-panel">
      <Center className="chart-empty">
        <Stack align="center" gap="sm" ta="center">
          <ThemeIcon size={38} radius="md" variant="light" color="sage"><ActivityIcon /></ThemeIcon>
          <Box>
            <Text size="sm" fw={600}>Connect a collector to start</Text>
            <Text size="xs" c="dimmed" maw={380} mt={3}>Create a collector key, then add it to your coding agent collector.</Text>
          </Box>
          <Button component="a" href="/settings" variant="light" color="sage">Set up collector</Button>
        </Stack>
      </Center>
    </ChartPanel>
  )
}

export const hasValues = (data: ReadonlyArray<Record<string, unknown>>, keys: ReadonlyArray<string>): boolean =>
  data.some((row) => keys.some((key) => typeof row[key] === "number" && row[key] > 0))

export const dailyChartData = (daily: ReadonlyArray<DailyMetric>) => daily.map((day) => ({
  ...day,
  label: formatDate(day.date)
}))

export const commonXAxisProps = { minTickGap: 28, tickMargin: 10 }
export const commonYAxisProps = { width: 48 }
const commonTooltipProps = { offset: 16, isAnimationActive: false }
const unmeasuredTooltipHeight = 192

export function useTrackedChartTooltip() {
  const [tooltipY, setTooltipY] = useState<number | null>(null)
  const pointerActive = useRef(false)

  const placeTooltip = (target: HTMLElement, pointerY: number, tooltipHeight: number) => {
    const bounds = target.getBoundingClientRect()
    const below = pointerY + commonTooltipProps.offset
    const nextY = Math.round(
      below + tooltipHeight + commonTooltipProps.offset > bounds.height
        ? Math.max(commonTooltipProps.offset, pointerY - tooltipHeight - commonTooltipProps.offset)
        : below
    )

    setTooltipY((current) => current === nextY ? current : nextY)
  }

  const measureTooltip = (target: HTMLElement) => {
    const tooltip = target.querySelector<HTMLElement>(".recharts-tooltip-wrapper")
    return tooltip && getComputedStyle(tooltip).visibility !== "hidden" ? tooltip.offsetHeight : 0
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return

    pointerActive.current = true
    const target = event.currentTarget
    const bounds = target.getBoundingClientRect()
    const pointerY = event.clientY - bounds.top
    const tooltipHeight = measureTooltip(target)

    placeTooltip(target, pointerY, tooltipHeight || unmeasuredTooltipHeight)

    if (tooltipHeight === 0) {
      requestAnimationFrame(() => {
        if (!pointerActive.current || !target.isConnected) return
        const measuredHeight = measureTooltip(target)
        if (measuredHeight > 0) placeTooltip(target, pointerY, measuredHeight)
      })
    }
  }

  return {
    trackingProps: {
      onPointerMove,
      onPointerLeave: () => {
        pointerActive.current = false
        setTooltipY(null)
      }
    },
    tooltipProps: {
      ...commonTooltipProps,
      position: tooltipY === null ? undefined : { y: tooltipY }
    }
  }
}
