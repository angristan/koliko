import type { ReactNode } from "react"
import {
  Box,
  Center,
  Divider,
  Loader,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  type MantineColor
} from "@mantine/core"

export function InstrumentStrip({
  metrics
}: {
  readonly metrics: ReadonlyArray<{
    readonly group: string
    readonly label: string
    readonly value: string
    readonly detail?: string
    readonly progress?: number
    readonly color?: MantineColor
  }>
}) {
  const groups = metrics.reduce<Array<{ label: string; metrics: Array<(typeof metrics)[number]> }>>((result, metric) => {
    const current = result.at(-1)
    if (current?.label === metric.group) current.metrics.push(metric)
    else result.push({ label: metric.group, metrics: [metric] })
    return result
  }, [])

  return (
    <Paper component="section" aria-label="Usage summary" withBorder className="instrument-strip">
      <Box className="instrument-grid" data-count={groups.length}>
        {groups.map((group) => (
          <Box className="instrument-group" key={group.label}>
            <Text className="instrument-group-label">{group.label}</Text>
            <Box className="instrument-group-grid" style={{ gridTemplateColumns: `repeat(${group.metrics.length}, minmax(0, 1fr))` }}>
              {group.metrics.map((metric) => (
                <Box className="instrument-cell" key={metric.label}>
                  <Text size="xs" fw={600} c="dimmed" className="metric-label" truncate>{metric.label}</Text>
                  <Text className="metric-value" mt={6}>{metric.value}</Text>
                  {metric.detail && <Text size="xs" c="dimmed" mt={1}>{metric.detail}</Text>}
                  {metric.progress !== undefined && (
                    <Progress aria-label={`${metric.label} progress`} value={Math.max(0, Math.min(100, metric.progress))} color={metric.color ?? "sage"} size={3} radius={0} mt={6} />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  )
}

export function Panel({
  title,
  detail,
  children,
  className = ""
}: {
  readonly title: string
  readonly detail?: string
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <Paper withBorder radius="md" className={`panel ${className}`.trim()}>
      <Group justify="space-between" gap="sm" className="panel-header">
        <Text fw={600} className="panel-title">{title}</Text>
        {detail && <Text size="xs" c="dimmed">{detail}</Text>}
      </Group>
      <Divider />
      <Box className="panel-body">{children}</Box>
    </Paper>
  )
}

export function EmptyState({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return (
    <Center className="empty-state">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon size={42} radius="md" variant="light" color="sky">{icon}</ThemeIcon>
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed" maw={360}>{detail}</Text>
      </Stack>
    </Center>
  )
}

export function ChartsFallback() {
  return (
    <Paper withBorder radius="md" className="panel chart-loading">
      <Center h={220}><Loader size="sm" /></Center>
    </Paper>
  )
}
