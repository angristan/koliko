import { lazy, Suspense, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
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
import type { DashboardResponse, SessionDetailResponse } from "../shared/api"
import {
  apiKeysQueryOptions,
  authQueryOptions,
  dashboardQueryOptions,
  sessionQueryOptions,
  useCreateApiKeyMutation,
  useLoginMutation,
  useLogoutMutation,
  useRegisterPasskeyMutation,
  useRevokeApiKeyMutation
} from "./queries"

type Tab = "overview" | "analytics" | "sessions" | "settings"

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)
const rangeForDays = (days: number) => ({
  from: isoDate(new Date(Date.now() - (days - 1) * 86_400_000)),
  to: isoDate(new Date())
})

const OverviewCharts = lazy(() => import("./AnalyticsCharts").then(({ OverviewCharts }) => ({ default: OverviewCharts })))
const AnalyticsWorkspace = lazy(() => import("./AnalyticsCharts").then(({ AnalyticsWorkspace }) => ({ default: AnalyticsWorkspace })))

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en")
const money = new Intl.NumberFormat("en", {
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
const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

const pageTitles: Readonly<Record<Tab, { readonly title: string; readonly description: string }>> = {
  overview: { title: "Overview", description: "See where your agent time, tokens, and spend are going." },
  analytics: { title: "Analytics", description: "Explore usage, cost, tools, sessions, and agent feature trends." },
  sessions: { title: "Sessions", description: "Inspect recent runs and their privacy-safe event metadata." },
  settings: { title: "Settings", description: "Manage collector access, passkeys, and your data boundary." }
}

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="logo-stem" d="M7 3.5v17" />
      <path className="logo-branch" d="m8 12 10-7.5M8 12l10 7.5" />
      <circle className="logo-node-center" cx="8" cy="12" r="2" />
      <circle className="logo-node-end" cx="18" cy="4.5" r="1.5" />
      <circle className="logo-node-end" cx="18" cy="19.5" r="1.5" />
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
      cols={{ base: 2, sm: metrics.length }}
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

function Login({ hasPasskey }: { readonly hasPasskey: boolean }) {
  const [token, setToken] = useState("")
  const loginMutation = useLoginMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const error = loginMutation.error ?? registerMutation.error
  const busy = loginMutation.isPending || registerMutation.isPending

  const act = async () => {
    try {
      if (hasPasskey) await loginMutation.mutateAsync()
      else await registerMutation.mutateAsync(token)
    } catch {
      // The mutation keeps the typed error for the alert below.
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

            {error && <Alert color="red" icon={<WarningCircleIcon />} title="Authentication failed">{errorMessage(error, "Authentication failed")}</Alert>}

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

function SessionDrawer({
  opened,
  detail,
  pending,
  error,
  onClose,
  onRetry
}: {
  readonly opened: boolean
  readonly detail: SessionDetailResponse | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly onClose: () => void
  readonly onRetry: () => void
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={detail ? (
        <Box>
          <Text fw={700}>{detail.repository}</Text>
          <Text size="xs" c="dimmed">{detail.truncated ? `${detail.events.length} latest events` : `${detail.events.length} events`}</Text>
        </Box>
      ) : "Session details"}
      classNames={{ content: "session-drawer", header: "session-drawer-header" }}
    >
      {pending && <Center mih={240}><Loader type="dots" /></Center>}
      {error !== null && (
        <Alert color="red" icon={<WarningCircleIcon />} title="Session unavailable">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(error, "Session could not be loaded")}</Text>
            <Button variant="light" onClick={onRetry}>Retry</Button>
          </Stack>
        </Alert>
      )}
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

function Settings() {
  const apiKeysQuery = useQuery(apiKeysQueryOptions())
  const createMutation = useCreateApiKeyMutation()
  const revokeMutation = useRevokeApiKeyMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const logoutMutation = useLogoutMutation()
  const [name, setName] = useState("Local Pi collector")
  const [createdKey, setCreatedKey] = useState<string>()
  const [message, setMessage] = useState<string>()
  const keys = apiKeysQuery.data?.keys ?? []

  const create = () => {
    createMutation.mutate(name, {
      onSuccess: (result) => {
        setCreatedKey(result.key)
        setMessage("Copy this key now. It will not be shown again.")
      },
      onError: (cause) => setMessage(errorMessage(cause, "API key could not be created"))
    })
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

            {apiKeysQuery.error !== null && <Alert color="red" icon={<WarningCircleIcon />}>{errorMessage(apiKeysQuery.error, "API keys could not be loaded")}</Alert>}
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
              <Button loading={createMutation.isPending} onClick={create} leftSection={<KeyIcon />}>Create key</Button>
            </Group>
          </Stack>

          <Divider />
          <Stack gap={0} className="key-list">
            {apiKeysQuery.isPending && <Center mih={120}><Loader type="dots" /></Center>}
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
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    loading={revokeMutation.isPending && revokeMutation.variables === key.id}
                    onClick={() => revokeMutation.mutate(key.id, {
                      onError: (cause) => setMessage(errorMessage(cause, "API key could not be revoked"))
                    })}
                  >Revoke</Button>
                )}
              </Group>
            ))}
            {!apiKeysQuery.isPending && keys.length === 0 && <EmptyState icon={<KeyIcon />} title="No collector keys" detail="Create your first key to connect a coding agent." />}
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
            <Button
              variant="light"
              loading={registerMutation.isPending}
              onClick={() => registerMutation.mutate(undefined, {
                onSuccess: () => setMessage("Passkey added."),
                onError: (cause) => setMessage(errorMessage(cause, "Passkey could not be added"))
              })}
              leftSection={<ShieldCheckIcon />}
            >Add passkey</Button>
            <Button
              variant="subtle"
              color="gray"
              loading={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate(undefined, {
                onError: (cause) => setMessage(errorMessage(cause, "Could not sign out"))
              })}
              leftSection={<SignOutIcon />}
            >Sign out</Button>
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

function ChartsFallback() {
  return (
    <Paper withBorder radius="md" className="panel chart-loading">
      <Center h={220}><Loader size="sm" /></Center>
    </Paper>
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
      <Suspense fallback={<ChartsFallback />}>
        <OverviewCharts dashboard={dashboard} />
      </Suspense>
    </Stack>
  )
}

function Analytics({ dashboard, toolSuccess }: { readonly dashboard: DashboardResponse | undefined; readonly toolSuccess: number }) {
  const summary = dashboard?.summary
  return (
    <Stack gap="sm">
      <MetricGrid metrics={[
        { label: "Tool calls", value: integer.format(summary?.toolCalls ?? 0), detail: `${formatPercent(toolSuccess)} successful`, progress: toolSuccess * 100, color: "teal" },
        { label: "Compactions", value: integer.format(summary?.compactions ?? 0), detail: "context checkpoints", color: "orange" },
        { label: "Goal events", value: integer.format(summary?.goals ?? 0), detail: "lifecycle updates", color: "tangerine" },
        { label: "Sub-agent events", value: integer.format(summary?.subagents ?? 0), detail: "delegated work", color: "yellow" }
      ]} />
      <Suspense fallback={<ChartsFallback />}>
        <AnalyticsWorkspace dashboard={dashboard} />
      </Suspense>
    </Stack>
  )
}

function Sessions({ dashboard, setSessionId }: {
  readonly dashboard: DashboardResponse | undefined
  readonly setSessionId: (sessionId: string) => void
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
                    <Button size="compact-sm" variant="subtle" rightSection={<ArrowRightIcon />} onClick={() => setSessionId(row.id)}>Inspect</Button>
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
  { tab: "analytics", label: "Analytics", icon: ChartLineUpIcon },
  { tab: "sessions", label: "Sessions", icon: ListBulletsIcon },
  { tab: "settings", label: "Settings", icon: GearSixIcon }
]

export default function App() {
  const [tab, setTab] = useState<Tab>("overview")
  const [days, setDays] = useState(30)
  const [sessionId, setSessionId] = useState<string>()
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [mobileOpened, mobileNavigation] = useDisclosure(false)
  const isDesktop = useMediaQuery("(min-width: 48em)")
  const computedColorScheme = useComputedColorScheme("light")
  const { toggleColorScheme } = useMantineColorScheme()

  const range = useMemo(() => rangeForDays(days), [days])
  const authQuery = useQuery(authQueryOptions())
  const dashboardQuery = useQuery({
    ...dashboardQueryOptions(range.from, range.to),
    enabled: authQuery.data?.authenticated === true
  })
  const sessionQuery = useQuery({
    ...sessionQueryOptions(sessionId ?? ""),
    enabled: sessionId !== undefined
  })

  if (authQuery.isPending) {
    return <Center mih="100vh"><Stack align="center" gap="sm"><Loader type="dots" /><Text size="sm" c="dimmed">Loading Koliko</Text></Stack></Center>
  }
  if (authQuery.isError) {
    return (
      <Center mih="100vh">
        <Alert color="red" icon={<WarningCircleIcon />} title="Koliko could not be loaded">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(authQuery.error, "Authentication status could not be loaded")}</Text>
            <Button variant="light" onClick={() => void authQuery.refetch()}>Retry</Button>
          </Stack>
        </Alert>
      </Center>
    )
  }
  if (!authQuery.data.authenticated) return <Login hasPasskey={authQuery.data.hasPasskey} />

  const dashboard = dashboardQuery.data
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
                  <ActionIcon variant="default" size="lg" aria-label="Refresh dashboard" loading={dashboardQuery.isFetching} onClick={() => void dashboardQuery.refetch()}>
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

          {dashboardQuery.error !== null && <Alert color="red" icon={<WarningCircleIcon />} title="Dashboard unavailable" mb="lg">{errorMessage(dashboardQuery.error, "Dashboard could not be loaded")}</Alert>}
          <Box key={tab} className="page-content">
            {dashboardQuery.isPending && tab !== "settings"
              ? <Center mih={320}><Loader type="dots" /></Center>
              : (
                <>
                  {tab === "overview" && <Overview dashboard={dashboard} cacheRate={cacheRate} toolSuccess={toolSuccess} />}
                  {tab === "analytics" && <Analytics dashboard={dashboard} toolSuccess={toolSuccess} />}
                  {tab === "sessions" && <Sessions dashboard={dashboard} setSessionId={setSessionId} />}
                  {tab === "settings" && <Settings />}
                </>
              )}
          </Box>
        </Box>
      </AppShell.Main>

      <SessionDrawer
        opened={sessionId !== undefined}
        detail={sessionQuery.data}
        pending={sessionQuery.isPending}
        error={sessionQuery.error}
        onClose={() => setSessionId(undefined)}
        onRetry={() => { void sessionQuery.refetch() }}
      />
    </AppShell>
  )
}
