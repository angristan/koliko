import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  Card,
  Center,
  Code,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Loader,
  NavLink,
  Paper,
  PasswordInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
  type MantineColor
} from "@mantine/core"
import { useDisclosure, useMediaQuery } from "@mantine/hooks"
import {
  ActivityIcon,
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CoinsIcon,
  CopyIcon,
  CurrencyDollarIcon,
  DatabaseIcon,
  GearSixIcon,
  GithubLogoIcon,
  KeyIcon,
  ListBulletsIcon,
  LockKeyIcon,
  MoonIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SparkleIcon,
  SunIcon,
  TerminalWindowIcon,
  TimerIcon,
  WarningCircleIcon,
  WrenchIcon
} from "@phosphor-icons/react"
import type {
  ApiKeySummary,
  DashboardResponse,
  SessionDetailResponse,
  UsageBreakdown
} from "../shared/api"
import {
  createApiKey,
  getApiKeys,
  getAuthStatus,
  getDashboard,
  getSession,
  loginWithPasskey,
  logout,
  registerPasskey,
  revokeApiKey
} from "./api"

type Tab = "overview" | "features" | "sessions" | "settings"

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)
const rangeForDays = (days: number) => ({
  from: isoDate(new Date(Date.now() - (days - 1) * 86_400_000)),
  to: isoDate(new Date())
})

const MantineBarChart = lazy(() => import("@mantine/charts").then(({ BarChart }) => ({ default: BarChart })))

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en")
const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
})
const summaryMoney = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.round(milliseconds / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

const pageTitles: Readonly<Record<Tab, { readonly title: string; readonly description: string }>> = {
  overview: { title: "Overview", description: "See where your agent time, tokens, and spend are going." },
  features: { title: "Agent features", description: "Understand tools, reasoning, compaction, goals, and delegation." },
  sessions: { title: "Sessions", description: "Inspect recent runs and their privacy-safe event metadata." },
  settings: { title: "Settings", description: "Manage collector access, passkeys, and your data boundary." }
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17 9 12l4 3 7-9" />
      <circle cx="4" cy="17" r="1.75" />
      <circle cx="9" cy="12" r="1.75" />
      <circle cx="13" cy="15" r="1.75" />
      <circle cx="20" cy="6" r="1.75" />
    </svg>
  )
}

function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Group gap="sm" wrap="nowrap" className="brand">
      <span className="brand-mark"><LogoMark /></span>
      {!compact && (
        <Box>
          <Text fw={700} lh={1.05} className="brand-name">koliko</Text>
          <Text size="xs" c="dimmed" mt={3}>Agent analytics</Text>
        </Box>
      )}
    </Group>
  )
}

const metricVisuals: Readonly<Record<string, ReactNode>> = {
  Sessions: <ChatsCircleIcon />,
  "Agent time": <TimerIcon />,
  Tokens: <CoinsIcon />,
  Cost: <CurrencyDollarIcon />,
  "Cache read": <DatabaseIcon />,
  "Tool success": <WrenchIcon />,
  "Tool calls": <WrenchIcon />,
  Compactions: <DatabaseIcon />,
  "Goal events": <ActivityIcon />,
  "Sub-agent events": <ChatsCircleIcon />
}

function MetricGrid({
  metrics
}: {
  readonly metrics: ReadonlyArray<{
    readonly label: string
    readonly value: string
    readonly detail?: string
    readonly progress?: number
    readonly color?: MantineColor
  }>
}) {
  return (
    <SimpleGrid
      cols={{ base: 2, sm: 3, lg: metrics.length }}
      spacing={{ base: "xs", sm: "sm" }}
      className="metric-grid"
    >
      {metrics.map((metric) => (
        <Card
          withBorder
          radius="sm"
          padding="xs"
          className="metric-card"
          key={metric.label}
        >
          <Group justify="space-between" align="center" gap={4} wrap="nowrap">
            <Text size="xs" fw={600} c="dimmed" className="metric-label" truncate>{metric.label}</Text>
            <ThemeIcon variant="light" color={metric.color ?? "gray"} radius="sm" size={24} className="metric-icon">
              {metricVisuals[metric.label] ?? <ActivityIcon />}
            </ThemeIcon>
          </Group>
          <Text className="metric-value" mt={6}>{metric.value}</Text>
          {metric.detail && <Text size="xs" c="dimmed" mt={1} truncate>{metric.detail}</Text>}
          {metric.progress !== undefined && (
            <Progress value={Math.max(0, Math.min(100, metric.progress))} color={metric.color ?? "tangerine"} size={2} radius="xl" mt={5} />
          )}
        </Card>
      ))}
    </SimpleGrid>
  )
}

function Panel({
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

function ActivityChart({ data }: { readonly data: DashboardResponse["daily"] }) {
  const [tooltipY, setTooltipY] = useState<number>()
  const rawMax = Math.max(0, ...data.map((day) => day.tokens))
  const total = data.reduce((sum, day) => sum + day.tokens, 0)
  const cost = data.reduce((sum, day) => sum + day.cost, 0)
  const chartData = data.map((day) => ({
    date: new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }),
    tokens: day.tokens
  }))

  return (
    <Panel title="Daily tokens" detail={`Tokens ${compactNumber.format(total)} · Cost ${summaryMoney.format(cost)}`} className="chart-panel">
      {data.length === 0 || rawMax === 0 ? (
        <EmptyState icon={<ChartLineUpIcon />} title="No token activity" detail="Usage will appear here after your collector sends its first session." />
      ) : (
        <Box className="chart-wrap">
          <Suspense fallback={<Center h={190}><Loader size="sm" /></Center>}>
            <MantineBarChart
              h={190}
              data={chartData}
              dataKey="date"
              series={[{ name: "tokens", label: "Tokens", color: "tangerine.5" }]}
              maxBarWidth={18}
              fillOpacity={0.9}
              strokeDasharray="0"
              tickLine="none"
              valueFormatter={(value) => compactNumber.format(value)}
              tooltipProps={{
                offset: 20,
                position: tooltipY === undefined
                  ? undefined
                  : { y: Math.min(Math.max(tooltipY - 28, 10), 126) }
              }}
              barProps={{ radius: [4, 4, 0, 0], isAnimationActive: false }}
              barChartProps={{ margin: { top: 6, right: 4, bottom: 4, left: 0 } }}
              xAxisProps={{ minTickGap: 32, tickMargin: 12 }}
              yAxisProps={{ width: 44, tickFormatter: (value: number) => compactNumber.format(value) }}
              className="activity-chart"
              aria-label="Daily token usage bar chart"
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                setTooltipY(event.clientY - bounds.top)
              }}
              onPointerLeave={() => setTooltipY(undefined)}
            />
          </Suspense>
        </Box>
      )}
    </Panel>
  )
}

function EmptyState({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return (
    <Center className="empty-state">
      <Stack align="center" gap="xs" ta="center">
        <ThemeIcon size={42} radius="xl" variant="light" color="gray">{icon}</ThemeIcon>
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed" maw={360}>{detail}</Text>
      </Stack>
    </Center>
  )
}

function UsageTable({ rows }: { readonly rows: ReadonlyArray<UsageBreakdown> }) {
  if (rows.length === 0) {
    return <EmptyState icon={<DatabaseIcon />} title="No data yet" detail="There is no usage for this breakdown in the selected range." />
  }

  return (
    <Table.ScrollContainer minWidth={430}>
      <Table verticalSpacing="xs" horizontalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th ta="right">Sessions</Table.Th>
            <Table.Th ta="right">Turns</Table.Th>
            <Table.Th ta="right">Tokens</Table.Th>
            <Table.Th ta="right">Cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.slice(0, 10).map((row) => (
            <Table.Tr key={row.key}>
              <Table.Td><Code>{row.label}</Code></Table.Td>
              <Table.Td ta="right">{integer.format(row.sessions)}</Table.Td>
              <Table.Td ta="right">{integer.format(row.turns)}</Table.Td>
              <Table.Td ta="right">{compactNumber.format(row.tokens)}</Table.Td>
              <Table.Td ta="right">{money.format(row.cost)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function Login({ hasPasskey, onAuthenticated }: { readonly hasPasskey: boolean; readonly onAuthenticated: () => void }) {
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const act = async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (hasPasskey) await loginWithPasskey()
      else await registerPasskey(token)
      onAuthenticated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <Paper radius="xl" className="auth-card">
        <section className="auth-showcase">
          <Brand />
          <Stack gap="lg" className="auth-showcase-copy">
            <Badge variant="light" color="tangerine" leftSection={<SparkleIcon size={12} />}>Private by design</Badge>
            <Title order={1}>Clarity for every<br /><span>agent run.</span></Title>
            <Text c="dimmed" maw={480}>Understand time, tokens, costs, and workflows without collecting the work itself.</Text>
          </Stack>
          <SimpleGrid cols={3} spacing="sm" className="auth-mini-metrics">
            {[["Prompts", "Never"], ["Source code", "Never"], ["Usage signals", "Only"]].map(([label, value]) => (
              <Paper key={label} p="md" radius="md" className="auth-mini-card">
                <Text size="xs" c="dimmed">{label}</Text>
                <Text fw={700} mt={4}>{value}</Text>
              </Paper>
            ))}
          </SimpleGrid>
        </section>

        <section className="auth-form">
          <Stack gap="xl">
            <Box>
              <ThemeIcon size={48} radius="md" variant="light" color="tangerine" mb="lg">
                {hasPasskey ? <LockKeyIcon size={24} /> : <ShieldCheckIcon size={24} />}
              </ThemeIcon>
              <Title order={2}>{hasPasskey ? "Welcome back" : "Set up your workspace"}</Title>
              <Text c="dimmed" size="sm" mt={8}>
                {hasPasskey ? "Use your passkey to securely continue to Koliko." : "Enter your bootstrap token, then register your first passkey."}
              </Text>
            </Box>

            {error && <Alert color="red" icon={<WarningCircleIcon />} title="Authentication failed">{error}</Alert>}

            {!hasPasskey && (
              <PasswordInput
                label="Bootstrap token"
                description="Configured in your Worker environment"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                placeholder="BOOTSTRAP_TOKEN"
                size="md"
              />
            )}

            <Button
              size="md"
              loading={busy}
              disabled={!hasPasskey && token.length === 0}
              onClick={() => void act()}
              leftSection={<ShieldCheckIcon size={18} />}
              rightSection={<ArrowRightIcon size={17} />}
              fullWidth
            >
              {hasPasskey ? "Continue with passkey" : "Register passkey"}
            </Button>

            <Group gap="xs" wrap="nowrap" align="flex-start">
              <ShieldCheckIcon size={16} className="privacy-icon" />
              <Text size="xs" c="dimmed">Prompts, responses, source code, tool arguments, and full paths never leave your machine.</Text>
            </Group>
          </Stack>
        </section>
      </Paper>
    </main>
  )
}

function SessionDrawer({ detail, onClose }: { readonly detail: SessionDetailResponse | undefined; readonly onClose: () => void }) {
  return (
    <Drawer
      opened={detail !== undefined}
      onClose={onClose}
      position="right"
      size="lg"
      title={detail ? (
        <Box>
          <Text fw={700}>{detail.repository}</Text>
          <Text size="xs" c="dimmed">{detail.truncated ? `${detail.events.length} latest events` : `${detail.events.length} events`}</Text>
        </Box>
      ) : undefined}
      classNames={{ content: "session-drawer", header: "session-drawer-header" }}
    >
      {detail?.truncated && <Alert color="yellow" mb="md">Showing the latest 500 events.</Alert>}
      <Stack gap={0} className="event-log">
        {detail?.events.map((event) => (
          <Box className="event-row" key={event.id}>
            <span className="event-dot" />
            <Box className="event-content">
              <Group justify="space-between" gap="md" align="flex-start">
                <Text size="sm" fw={600} tt="capitalize">{event.type.replaceAll("_", " ")}</Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </Text>
              </Group>
              <Group gap="xs" mt="xs">
                {event.toolName && <Code>{event.toolName}</Code>}
                {event.model && <Badge variant="light" color="gray">{event.provider}/{event.model}</Badge>}
                {event.tokens !== undefined && <Badge variant="light" color="tangerine">{compactNumber.format(event.tokens)} tokens</Badge>}
                {event.cost !== undefined && <Badge variant="light" color="gray">{money.format(event.cost)}</Badge>}
                {event.durationMs !== undefined && <Badge variant="light" color="gray">{formatDuration(event.durationMs)}</Badge>}
                {event.status === "error" && <Badge color="red" variant="light">error</Badge>}
              </Group>
            </Box>
          </Box>
        ))}
      </Stack>
    </Drawer>
  )
}

function Settings({ onLogout }: { readonly onLogout: () => void }) {
  const [keys, setKeys] = useState<ReadonlyArray<ApiKeySummary>>([])
  const [name, setName] = useState("Local Pi collector")
  const [createdKey, setCreatedKey] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const refresh = useCallback(async () => {
    const response = await getApiKeys()
    setKeys(response.keys)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const create = async () => {
    setBusy(true)
    try {
      const result = await createApiKey(name)
      setCreatedKey(result.key)
      setMessage("Copy this key now. It will not be shown again.")
      await refresh()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "API key could not be created")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md" className="settings-grid">
      <Box className="settings-main">
        <Panel title="Collector API keys" detail="Ingestion access">
          <Stack p="md" gap="md">
            <Box>
              <Text size="sm" fw={600}>Connect a collector</Text>
              <Text size="xs" c="dimmed" mt={4}>Create one independently revocable key for each coding-agent collector. Only hashes are stored.</Text>
            </Box>

            {message && <Alert color={createdKey ? "tangerine" : "red"} icon={createdKey ? <KeyIcon /> : <WarningCircleIcon />}>{message}</Alert>}

            {createdKey && (
              <Paper withBorder radius="md" p="md" className="created-key">
                <Group justify="space-between" wrap="nowrap">
                  <Code className="created-key-value">{createdKey}</Code>
                  <CopyButton value={createdKey} timeout={1600}>
                    {({ copied, copy }) => (
                      <Button variant="light" color={copied ? "teal" : "tangerine"} onClick={copy} leftSection={copied ? <CheckCircleIcon /> : <CopyIcon />}>
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              </Paper>
            )}

            <Group align="flex-end" wrap="nowrap" className="key-create">
              <TextInput label="Key name" value={name} onChange={(event) => setName(event.currentTarget.value)} flex={1} />
              <Button loading={busy} onClick={() => void create()} leftSection={<KeyIcon />}>Create key</Button>
            </Group>
          </Stack>

          <Divider />
          <Stack gap={0} className="key-list">
            {keys.map((key) => (
              <Group key={key.id} justify="space-between" wrap="nowrap" className="key-row">
                <Group wrap="nowrap" miw={0}>
                  <ThemeIcon variant="light" color={key.revokedAt ? "gray" : "tangerine"} radius="md"><KeyIcon /></ThemeIcon>
                  <Box miw={0}>
                    <Group gap="xs">
                      <Text size="sm" fw={600} truncate>{key.name}</Text>
                      {key.revokedAt && <Badge size="xs" variant="light" color="gray">Revoked</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed" truncate>{key.prefix}… · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</Text>
                  </Box>
                </Group>
                {!key.revokedAt && (
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => void revokeApiKey(key.id).then(refresh)}>Revoke</Button>
                )}
              </Group>
            ))}
            {keys.length === 0 && <EmptyState icon={<KeyIcon />} title="No collector keys" detail="Create your first key to connect a coding agent." />}
          </Stack>
        </Panel>
      </Box>

      <Stack gap="md" className="settings-side">
        <Panel title="Passkeys">
          <Stack p="md" gap="sm">
            <ThemeIcon size={40} radius="md" variant="light" color="tangerine"><ShieldCheckIcon /></ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>Passwordless security</Text>
              <Text size="xs" c="dimmed" mt={4}>User verification is required for every dashboard sign-in.</Text>
            </Box>
            <Button variant="light" onClick={() => void registerPasskey().then(() => setMessage("Passkey added."))} leftSection={<ShieldCheckIcon />}>Add passkey</Button>
            <Button variant="subtle" color="gray" onClick={() => void logout().then(onLogout)} leftSection={<SignOutIcon />}>Sign out</Button>
          </Stack>
        </Panel>

        <Panel title="Privacy boundary">
          <Stack p="md" gap="sm">
            {[
              ["Collected", "Usage counts, models, timing, cost, and lifecycle metadata."],
              ["Excluded", "Prompts, responses, code, arguments, output, and paths."],
              ["Repository", "Folder name only — never a remote or absolute path."]
            ].map(([label, detail]) => (
              <Group key={label} align="flex-start" wrap="nowrap">
                <CheckCircleIcon size={18} className="privacy-check" />
                <Box>
                  <Text size="xs" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed" mt={2}>{detail}</Text>
                </Box>
              </Group>
            ))}
          </Stack>
        </Panel>
      </Stack>
    </SimpleGrid>
  )
}

function Overview({ dashboard, cacheRate, toolSuccess }: {
  readonly dashboard: DashboardResponse | undefined
  readonly cacheRate: number
  readonly toolSuccess: number
}) {
  const summary = dashboard?.summary
  return (
    <Stack gap="sm">
      <MetricGrid metrics={[
        { label: "Sessions", value: integer.format(summary?.sessions ?? 0), detail: `${integer.format(summary?.turns ?? 0)} turns`, color: "tangerine" },
        { label: "Agent time", value: formatDuration(summary?.trackedMs ?? 0), detail: "active runtime", color: "yellow" },
        { label: "Tokens", value: compactNumber.format(summary?.totalTokens ?? 0), detail: `${compactNumber.format(summary?.outputTokens ?? 0)} output`, color: "tangerine" },
        { label: "Cost", value: money.format(summary?.cost ?? 0), detail: "provider reported", color: "orange" },
        { label: "Cache read", value: formatPercent(cacheRate), detail: `${compactNumber.format(summary?.cacheReadTokens ?? 0)} tokens`, progress: cacheRate * 100, color: "yellow" },
        { label: "Tool success", value: formatPercent(toolSuccess), detail: `${integer.format(summary?.toolCalls ?? 0)} calls`, progress: toolSuccess * 100, color: "teal" }
      ]} />
      <ActivityChart data={dashboard?.daily ?? []} />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <Panel title="Models" detail="By token volume"><UsageTable rows={dashboard?.models ?? []} /></Panel>
        <Panel title="Repositories" detail="Folder names"><UsageTable rows={dashboard?.repositories ?? []} /></Panel>
      </SimpleGrid>
    </Stack>
  )
}

function Features({ dashboard, toolSuccess }: { readonly dashboard: DashboardResponse | undefined; readonly toolSuccess: number }) {
  const summary = dashboard?.summary
  return (
    <Stack gap="sm">
      <MetricGrid metrics={[
        { label: "Tool calls", value: integer.format(summary?.toolCalls ?? 0), detail: `${formatPercent(toolSuccess)} successful`, progress: toolSuccess * 100, color: "teal" },
        { label: "Compactions", value: integer.format(summary?.compactions ?? 0), detail: "context checkpoints", color: "orange" },
        { label: "Goal events", value: integer.format(summary?.goals ?? 0), detail: "lifecycle updates", color: "tangerine" },
        { label: "Sub-agent events", value: integer.format(summary?.subagents ?? 0), detail: "delegated work", color: "yellow" }
      ]} />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <Panel title="Thinking levels" detail="Usage distribution"><UsageTable rows={dashboard?.thinking ?? []} /></Panel>
        <Panel title="Feature events" detail="Lifecycle counts">
          <Stack gap={0} className="feature-list">
            {dashboard?.features.map((feature) => (
              <Group justify="space-between" wrap="nowrap" className="feature-row" key={`${feature.feature}-${feature.label}`}>
                <Group wrap="nowrap" miw={0}>
                  <ThemeIcon variant="light" color="gray" radius="md"><SparkleIcon /></ThemeIcon>
                  <Box miw={0}>
                    <Text size="sm" fw={600} tt="capitalize" truncate>{feature.label.replaceAll("_", " ")}</Text>
                    <Text size="xs" c="dimmed" truncate>{feature.feature} · {feature.detail}</Text>
                  </Box>
                </Group>
                <Badge variant="light" color="gray">{integer.format(feature.count)}</Badge>
              </Group>
            ))}
            {(dashboard?.features.length ?? 0) === 0 && <EmptyState icon={<SparkleIcon />} title="No feature events" detail="Feature lifecycle events will appear here as agents use them." />}
          </Stack>
        </Panel>
      </SimpleGrid>
      <Panel title="Tool performance" detail="Top 50 tools">
        {(dashboard?.tools.length ?? 0) === 0 ? (
          <EmptyState icon={<WrenchIcon />} title="No tool calls" detail="Tool performance will appear after a session uses tools." />
        ) : (
          <Table.ScrollContainer minWidth={680}>
            <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tool</Table.Th>
                  <Table.Th ta="right">Calls</Table.Th>
                  <Table.Th ta="right">Errors</Table.Th>
                  <Table.Th ta="right">Total time</Table.Th>
                  <Table.Th ta="right">Success rate</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {dashboard?.tools.map((tool) => {
                  const success = tool.calls === 0 ? 1 : 1 - tool.errors / tool.calls
                  return (
                    <Table.Tr key={tool.name}>
                      <Table.Td><Code>{tool.name}</Code></Table.Td>
                      <Table.Td ta="right">{integer.format(tool.calls)}</Table.Td>
                      <Table.Td ta="right"><Text span c={tool.errors > 0 ? "red" : undefined}>{integer.format(tool.errors)}</Text></Table.Td>
                      <Table.Td ta="right">{formatDuration(tool.durationMs)}</Table.Td>
                      <Table.Td ta="right">
                        <Group gap="sm" justify="flex-end" wrap="nowrap">
                          <Progress value={success * 100} color={success > 0.95 ? "teal" : "orange"} w={64} size={5} />
                          <Text size="sm" w={45}>{formatPercent(success)}</Text>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Panel>
    </Stack>
  )
}

function Sessions({ dashboard, setSession }: {
  readonly dashboard: DashboardResponse | undefined
  readonly setSession: (session: SessionDetailResponse | undefined) => void
}) {
  return (
    <Panel title="Recent sessions" detail="Latest 50">
      {(dashboard?.sessions.length ?? 0) === 0 ? (
        <EmptyState icon={<ListBulletsIcon />} title="No sessions yet" detail="Recent agent sessions will show up here once data arrives." />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Repository</Table.Th>
                <Table.Th>Last activity</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th ta="right">Turns</Table.Th>
                <Table.Th ta="right">Tokens</Table.Th>
                <Table.Th ta="right">Cost</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dashboard?.sessions.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon size="sm" variant="light" color="tangerine" radius="sm"><TerminalWindowIcon /></ThemeIcon>
                      <Text size="sm" fw={600}>{row.repository}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{new Date(row.endedAt).toLocaleString()}</Text></Table.Td>
                  <Table.Td><Code>{row.model}</Code></Table.Td>
                  <Table.Td ta="right">{integer.format(row.turns)}</Table.Td>
                  <Table.Td ta="right">{compactNumber.format(row.tokens)}</Table.Td>
                  <Table.Td ta="right">{money.format(row.cost)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-sm" variant="subtle" rightSection={<ArrowRightIcon />} onClick={() => void getSession(row.id).then(setSession)}>Inspect</Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Panel>
  )
}

const navigation: ReadonlyArray<{ readonly tab: Tab; readonly label: string; readonly icon: typeof ActivityIcon }> = [
  { tab: "overview", label: "Overview", icon: ActivityIcon },
  { tab: "features", label: "Agent features", icon: TerminalWindowIcon },
  { tab: "sessions", label: "Sessions", icon: ListBulletsIcon },
  { tab: "settings", label: "Settings", icon: GearSixIcon }
]

export default function App() {
  const [auth, setAuth] = useState<{
    readonly loading: boolean
    readonly authenticated: boolean
    readonly hasPasskey: boolean
  }>({ loading: true, authenticated: false, hasPasskey: false })
  const [tab, setTab] = useState<Tab>("overview")
  const [days, setDays] = useState(30)
  const [dashboard, setDashboard] = useState<DashboardResponse>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [session, setSession] = useState<SessionDetailResponse>()
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [mobileOpened, mobileNavigation] = useDisclosure(false)
  const isDesktop = useMediaQuery("(min-width: 48em)")
  const computedColorScheme = useComputedColorScheme("light")
  const { toggleColorScheme } = useMantineColorScheme()

  const range = useMemo(() => rangeForDays(days), [days])
  const refreshAuth = useCallback(async () => {
    const status = await getAuthStatus()
    setAuth({ loading: false, authenticated: status.authenticated, hasPasskey: status.hasPasskey })
  }, [])

  const refreshDashboard = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setDashboard(await getDashboard(range.from, range.to))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard could not be loaded")
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { void refreshAuth() }, [refreshAuth])
  useEffect(() => { if (auth.authenticated) void refreshDashboard() }, [auth.authenticated, refreshDashboard])

  if (auth.loading) {
    return <Center mih="100vh"><Stack align="center" gap="sm"><Loader type="dots" /><Text size="sm" c="dimmed">Loading Koliko</Text></Stack></Center>
  }
  if (!auth.authenticated) return <Login hasPasskey={auth.hasPasskey} onAuthenticated={() => void refreshAuth()} />

  const summary = dashboard?.summary
  const cacheDenominator = (summary?.inputTokens ?? 0) + (summary?.cacheReadTokens ?? 0)
  const cacheRate = cacheDenominator === 0 ? 0 : (summary?.cacheReadTokens ?? 0) / cacheDenominator
  const toolSuccess = (summary?.toolCalls ?? 0) === 0
    ? 1
    : 1 - (summary?.toolErrors ?? 0) / (summary?.toolCalls ?? 1)
  const page = pageTitles[tab]

  const navigate = (next: Tab) => {
    setTab(next)
    mobileNavigation.close()
  }

  return (
    <AppShell
      layout="alt"
      header={{ height: 58 }}
      navbar={{ width: isDesktop && desktopCollapsed ? 56 : 208, breakpoint: "sm", collapsed: { mobile: !mobileOpened } }}
      padding={0}
      className="app-shell"
    >
      <AppShell.Header className="app-header">
        <Group h="100%" px={{ base: "md", sm: "lg" }} justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={mobileOpened}
              onClick={mobileNavigation.toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={mobileOpened ? "Close navigation" : "Open navigation"}
            />
            <Box hiddenFrom="sm"><Brand compact /></Box>
            <Title order={2} className="page-heading">{page.title}</Title>
          </Group>

          <Group gap="sm" wrap="nowrap">
            {tab !== "settings" && (
              <>
                <SegmentedControl
                  size="xs"
                  value={String(days)}
                  onChange={(value) => setDays(Number(value))}
                  data={[7, 30, 90].map((value) => ({ value: String(value), label: `${value}d` }))}
                  className="range-control"
                />
                <Tooltip label="Refresh dashboard">
                  <ActionIcon variant="default" size="lg" aria-label="Refresh dashboard" loading={loading} onClick={() => void refreshDashboard()}>
                    <ArrowClockwiseIcon />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            <Tooltip label={computedColorScheme === "dark" ? "Use light theme" : "Use dark theme"}>
              <ActionIcon variant="default" size="lg" aria-label="Toggle color theme" onClick={toggleColorScheme}>
                {computedColorScheme === "dark" ? <SunIcon /> : <MoonIcon />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={0} className="app-navbar" data-desktop-collapsed={desktopCollapsed}>
        <AppShell.Section className="navbar-brand"><Brand /></AppShell.Section>
        <AppShell.Section grow component={ScrollArea} className="navbar-navigation">
          <Stack gap={2}>
            {navigation.map((item) => (
              <Tooltip key={item.tab} label={item.label} position="right" disabled={!desktopCollapsed}>
                <NavLink
                  label={item.label}
                  aria-label={item.label}
                  leftSection={<item.icon size={19} />}
                  active={tab === item.tab}
                  onClick={() => navigate(item.tab)}
                  variant="light"
                  className="nav-item"
                />
              </Tooltip>
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section className="navbar-footer">
          <Group gap={4} justify="space-between" className="navbar-footer-actions">
            <Tooltip label="View on GitHub" position="right">
              <ActionIcon
                component="a"
                href="https://github.com/angristan/koliko"
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="View on GitHub"
              >
                <GithubLogoIcon size={19} />
              </ActionIcon>
            </Tooltip>
            <Box visibleFrom="sm">
              <Tooltip label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"} position="right">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => setDesktopCollapsed((collapsed) => !collapsed)}
                >
                  <SidebarSimpleIcon size={19} />
                </ActionIcon>
              </Tooltip>
            </Box>
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box className="content-shell">
          <Box className="content-intro">
            <Title order={1}>{page.title}</Title>
            <Text c="dimmed" mt={6}>{page.description}</Text>
          </Box>

          {error && <Alert color="red" icon={<WarningCircleIcon />} title="Dashboard unavailable" mb="lg">{error}</Alert>}
          <Box key={tab} className="page-content">
            {tab === "overview" && <Overview dashboard={dashboard} cacheRate={cacheRate} toolSuccess={toolSuccess} />}
            {tab === "features" && <Features dashboard={dashboard} toolSuccess={toolSuccess} />}
            {tab === "sessions" && <Sessions dashboard={dashboard} setSession={setSession} />}
            {tab === "settings" && <Settings onLogout={() => setAuth({ loading: false, authenticated: false, hasPasskey: true })} />}
          </Box>
        </Box>
      </AppShell.Main>

      <SessionDrawer detail={session} onClose={() => setSession(undefined)} />
    </AppShell>
  )
}
