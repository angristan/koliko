import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Box,
  Button,
  Center,
  Code,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Loader,
  Modal,
  NavLink,
  Paper,
  PasswordInput,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
  type MantineColor
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import {
  ActivityIcon,
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  CopyIcon,
  GearSixIcon,
  GithubLogoIcon,
  KeyIcon,
  ListBulletsIcon,
  LockKeyIcon,
  MoonIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SunIcon,
  TerminalWindowIcon,
  WarningCircleIcon
} from "@phosphor-icons/react"
import type { ApiKeySummary, DashboardResponse, PasskeySummary, SessionDetailResponse } from "../shared/api"
import {
  apiKeysQueryOptions,
  authQueryOptions,
  dashboardQueryOptions,
  passkeysQueryOptions,
  sessionQueryOptions,
  useCreateApiKeyMutation,
  useLoginMutation,
  useLogoutMutation,
  useRegisterPasskeyMutation,
  useRemovePasskeyMutation,
  useRevokeApiKeyMutation
} from "./queries"
import {
  dashboardHref,
  navigateDashboard,
  useDashboardLocation,
  type AnalyticsSection,
  type DashboardTab,
  type TrendMetric
} from "./navigation"
import {
  apiKeyRevocationMessage,
  loadingRangeMessage,
  retainedRangeMessage,
  toolSuccessPresentation
} from "./presentation"

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

const pageTitles: Readonly<Record<DashboardTab, { readonly title: string; readonly description?: string }>> = {
  overview: { title: "Overview", description: "See where your agent time, tokens, and spend are going." },
  analytics: { title: "Analytics", description: "Explore usage, cost, tools, sessions, and agent feature trends." },
  sessions: { title: "Sessions", description: "Inspect recent runs and their privacy-safe event metadata." },
  settings: { title: "Settings" }
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

function InstrumentStrip({
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
        <ThemeIcon size={42} radius="md" variant="light" color="sky">{icon}</ThemeIcon>
        <Text size="sm" fw={600}>{title}</Text>
        <Text size="xs" c="dimmed" maw={360}>{detail}</Text>
      </Stack>
    </Center>
  )
}

function Login({
  hasPasskey,
  colorScheme,
  onToggleColorScheme
}: {
  readonly hasPasskey: boolean
  readonly colorScheme: "light" | "dark"
  readonly onToggleColorScheme: () => void
}) {
  const [token, setToken] = useState("")
  const [passkeyName, setPasskeyName] = useState("Primary passkey")
  const loginMutation = useLoginMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const error = loginMutation.error ?? registerMutation.error
  const busy = loginMutation.isPending || registerMutation.isPending

  const act = async () => {
    try {
      if (hasPasskey) await loginMutation.mutateAsync()
      else await registerMutation.mutateAsync({ name: passkeyName.trim(), bootstrapToken: token })
    } catch {
      // The mutation keeps the typed error for the alert below.
    }
  }

  return (
    <main className="auth-shell">
      <Box className="auth-layout">
        <Group className="auth-brand" justify="space-between" wrap="nowrap">
          <Brand />
          <Group gap="xs" wrap="nowrap" className="appearance-controls">
            <Tooltip label={`Use ${colorScheme === "dark" ? "light" : "dark"} theme`}>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={`Use ${colorScheme === "dark" ? "light" : "dark"} theme`}
                onClick={onToggleColorScheme}
              >
                {colorScheme === "dark" ? <SunIcon /> : <MoonIcon />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Paper radius="lg" className="auth-card">
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault()
              void act()
            }}
          >
            <Stack gap="lg">
              <Group gap="md" wrap="nowrap" align="flex-start" className="auth-heading">
                <ThemeIcon size={40} radius="md" variant="light" color="honey">
                  {hasPasskey ? <LockKeyIcon size={20} /> : <ShieldCheckIcon size={20} />}
                </ThemeIcon>
                <Box>
                  <Title order={1}>{hasPasskey ? "Sign in to Koliko" : "Set up Koliko"}</Title>
                  <Text c="dimmed" size="sm" mt={4}>
                    {hasPasskey
                      ? "Use your passkey to open your dashboard."
                      : "Enter the bootstrap token configured for this Worker. You’ll create a passkey next."}
                  </Text>
                </Box>
              </Group>

              {error && <Alert color="rust" icon={<WarningCircleIcon />} title="Authentication failed">{errorMessage(error, "Authentication failed")}</Alert>}

              {!hasPasskey && (
                <Stack gap="sm">
                  <TextInput
                    label="Passkey name"
                    value={passkeyName}
                    onChange={(event) => setPasskeyName(event.currentTarget.value)}
                    placeholder="Primary passkey"
                    size="md"
                    maxLength={80}
                  />
                  <PasswordInput
                    label="Bootstrap token"
                    description="Configured in your Worker environment"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.currentTarget.value)}
                    placeholder="BOOTSTRAP_TOKEN"
                    size="md"
                  />
                </Stack>
              )}

              <Button
                className="auth-submit"
                type="submit"
                variant="filled"
                color="sage"
                size="md"
                loading={busy}
                disabled={!hasPasskey && (token.length === 0 || passkeyName.trim().length === 0)}
                leftSection={hasPasskey ? <LockKeyIcon size={18} /> : <ShieldCheckIcon size={18} />}
                fullWidth
              >
                {hasPasskey ? "Sign in with passkey" : "Create passkey"}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>
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
      closeButtonProps={{ "aria-label": "Close session details" }}
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
        <Alert color="rust" icon={<WarningCircleIcon />} title="Session unavailable">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(error, "Session could not be loaded")}</Text>
            <Button variant="light" onClick={onRetry}>Retry</Button>
          </Stack>
        </Alert>
      )}
      {detail?.truncated && <Alert color="honey" mb="md">Showing the latest 500 events.</Alert>}
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
                {event.model && <Badge variant="light" color="sky">{event.provider}/{event.model}</Badge>}
                {event.tokens !== undefined && <Badge variant="light" color="sky">{compactNumber.format(event.tokens)} tokens</Badge>}
                {event.cost !== undefined && <Badge variant="light" color="honey">{money.format(event.cost)}</Badge>}
                {event.durationMs !== undefined && <Badge variant="light" color="sage">{formatDuration(event.durationMs)}</Badge>}
                {event.status === "error" && <Badge color="rust" variant="light">error</Badge>}
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
  const passkeysQuery = useQuery(passkeysQueryOptions())
  const createMutation = useCreateApiKeyMutation()
  const revokeMutation = useRevokeApiKeyMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const removePasskeyMutation = useRemovePasskeyMutation()
  const logoutMutation = useLogoutMutation()
  const [keyName, setKeyName] = useState("Local Pi collector")
  const [passkeyName, setPasskeyName] = useState("")
  const [createdKey, setCreatedKey] = useState<string>()
  const [keyMessage, setKeyMessage] = useState<string>()
  const [passkeyToRemove, setPasskeyToRemove] = useState<PasskeySummary>()
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<ApiKeySummary>()
  const keys = apiKeysQuery.data?.keys ?? []
  const passkeys = passkeysQuery.data?.passkeys ?? []

  const createKey = () => {
    createMutation.mutate(keyName, {
      onSuccess: (result) => {
        setCreatedKey(result.key)
        setKeyMessage("Copy this key now. It will not be shown again.")
      },
      onError: (cause) => setKeyMessage(errorMessage(cause, "API key could not be created"))
    })
  }

  const addPasskey = () => {
    registerMutation.mutate({ name: passkeyName.trim() }, {
      onSuccess: () => setPasskeyName("")
    })
  }

  const confirmPasskeyRemoval = () => {
    if (!passkeyToRemove) return
    removePasskeyMutation.mutate(passkeyToRemove.id, {
      onSuccess: () => setPasskeyToRemove(undefined)
    })
  }

  const confirmApiKeyRevocation = () => {
    if (!apiKeyToRevoke) return
    revokeMutation.mutate(apiKeyToRevoke.id, {
      onSuccess: () => setApiKeyToRevoke(undefined),
      onError: (cause) => setKeyMessage(errorMessage(cause, "API key could not be revoked"))
    })
  }

  return (
    <>
      <Stack gap={0} className="settings-page">
        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Collector keys</Text>
            <Text size="xs" c="dimmed" mt={3}>Create one independently revocable key for each collector. Only hashes are stored.</Text>
          </Box>

          {apiKeysQuery.error !== null && <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>{errorMessage(apiKeysQuery.error, "API keys could not be loaded")}</Alert>}
          {keyMessage && <Alert mb="md" color={createdKey ? "sage" : "rust"} icon={createdKey ? <KeyIcon /> : <WarningCircleIcon />}>{keyMessage}</Alert>}

          {createdKey && (
            <Paper withBorder radius="md" p="md" mb="md" className="created-key">
              <Group justify="space-between" wrap="nowrap">
                <Code className="created-key-value">{createdKey}</Code>
                <CopyButton value={createdKey} timeout={1600}>
                  {({ copied, copy }) => (
                    <Button variant="light" color={copied ? "sage" : "sky"} onClick={copy} leftSection={copied ? <CheckCircleIcon /> : <CopyIcon />}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            </Paper>
          )}

          <Group align="flex-end" wrap="nowrap" className="settings-create-row">
            <TextInput label="Key name" value={keyName} onChange={(event) => setKeyName(event.currentTarget.value)} flex={1} maxLength={80} />
            <Button
              className="accent-action"
              variant="filled"
              color="sage"
              loading={createMutation.isPending}
              disabled={keyName.trim().length === 0}
              onClick={createKey}
              leftSection={<KeyIcon />}
            >Create key</Button>
          </Group>

          <Stack gap={0} className="settings-list">
            {apiKeysQuery.isPending && <Center mih={72}><Loader type="dots" /></Center>}
            {keys.map((key) => (
              <Group key={key.id} justify="space-between" wrap="nowrap" className="settings-list-row">
                <Box miw={0}>
                  <Group gap="xs" className="settings-resource-heading">
                    <Text size="sm" fw={600} className="settings-resource-name">{key.name}</Text>
                    {key.revokedAt && <Badge size="xs" variant="light" color="gray">Revoked</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed" className="settings-resource-meta">{key.prefix}… · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</Text>
                </Box>
                {!key.revokedAt && (
                  <Button
                    variant="light"
                    color="rust"
                    loading={revokeMutation.isPending && revokeMutation.variables === key.id}
                    onClick={() => setApiKeyToRevoke(key)}
                  >Revoke</Button>
                )}
              </Group>
            ))}
            {!apiKeysQuery.isPending && keys.length === 0 && <Text size="sm" c="dimmed" className="settings-empty-row">No collector keys yet.</Text>}
          </Stack>
        </Box>

        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Passkeys</Text>
            <Text size="xs" c="dimmed" mt={3}>Name passkeys so you can recognize and remove old devices.</Text>
          </Box>

          {(passkeysQuery.error !== null || registerMutation.error !== null || removePasskeyMutation.error !== null) && (
            <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>
              {errorMessage(passkeysQuery.error ?? registerMutation.error ?? removePasskeyMutation.error, "Passkeys could not be updated")}
            </Alert>
          )}

          <Group align="flex-end" wrap="nowrap" className="settings-create-row">
            <TextInput
              label="Passkey name"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.currentTarget.value)}
              placeholder="MacBook Touch ID"
              flex={1}
              maxLength={80}
            />
            <Button
              variant="light"
              loading={registerMutation.isPending}
              disabled={passkeyName.trim().length === 0}
              onClick={addPasskey}
              leftSection={<ShieldCheckIcon />}
            >Add passkey</Button>
          </Group>

          <Stack gap={0} className="settings-list">
            {passkeysQuery.isPending && <Center mih={72}><Loader type="dots" /></Center>}
            {passkeys.map((passkey) => (
              <Group key={passkey.id} justify="space-between" wrap="nowrap" className="settings-list-row">
                <Box miw={0}>
                  <Text size="sm" fw={600} className="settings-resource-name">{passkey.name}</Text>
                  <Text size="xs" c="dimmed" className="settings-resource-meta">
                    {passkey.backedUp ? "Synced" : passkey.deviceType === "multiDevice" ? "Multi-device" : "Device-bound"}
                    {` · added ${new Date(passkey.createdAt).toLocaleDateString()}`}
                    {passkey.lastUsedAt ? ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : " · never used"}
                    {passkeys.length === 1 ? " · only passkey" : ""}
                  </Text>
                </Box>
                {passkeys.length > 1 && (
                  <Button
                    variant="light"
                    color="rust"
                    onClick={() => setPasskeyToRemove(passkey)}
                  >Remove</Button>
                )}
              </Group>
            ))}
          </Stack>
        </Box>

        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Session</Text>
          </Box>
          {logoutMutation.error && <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>{errorMessage(logoutMutation.error, "Could not sign out")}</Alert>}
          <Group justify="space-between" wrap="nowrap" className="settings-session-row">
            <Text size="sm">This browser</Text>
            <Button variant="default" loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()} leftSection={<SignOutIcon />}>Sign out</Button>
          </Group>
        </Box>
      </Stack>

      <Modal
        opened={apiKeyToRevoke !== undefined}
        onClose={() => setApiKeyToRevoke(undefined)}
        title="Revoke collector key?"
        closeButtonProps={{ "aria-label": "Close collector key revocation" }}
        centered
        returnFocus
      >
        <Stack gap="md">
          <Text size="sm">{apiKeyToRevoke ? apiKeyRevocationMessage(apiKeyToRevoke.name) : "Ingestion from this collector will stop."}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setApiKeyToRevoke(undefined)}>Cancel</Button>
            <Button color="rust" loading={revokeMutation.isPending} onClick={confirmApiKeyRevocation}>Revoke key</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={passkeyToRemove !== undefined}
        onClose={() => setPasskeyToRemove(undefined)}
        title="Remove passkey?"
        closeButtonProps={{ "aria-label": "Close passkey removal" }}
        centered
        returnFocus
      >
        <Stack gap="md">
          <Text size="sm">{passkeyToRemove ? `“${passkeyToRemove.name}” will no longer be able to sign in to Koliko.` : "This passkey will no longer be able to sign in to Koliko."}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPasskeyToRemove(undefined)}>Cancel</Button>
            <Button color="rust" loading={removePasskeyMutation.isPending} onClick={confirmPasskeyRemoval}>Remove passkey</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

function ChartsFallback() {
  return (
    <Paper withBorder radius="md" className="panel chart-loading">
      <Center h={220}><Loader size="sm" /></Center>
    </Paper>
  )
}

function Overview({ dashboard, cacheRate, toolSuccess, trendMetric, onTrendMetricChange }: {
  readonly dashboard: DashboardResponse | undefined
  readonly cacheRate: number
  readonly toolSuccess: ReturnType<typeof toolSuccessPresentation>
  readonly trendMetric: TrendMetric
  readonly onTrendMetricChange: (metric: TrendMetric) => void
}) {
  const summary = dashboard?.summary
  return (
    <Stack gap="sm">
      <InstrumentStrip metrics={[
        { group: "Activity", label: "Sessions", value: integer.format(summary?.sessions ?? 0), detail: `${integer.format(summary?.turns ?? 0)} turns`, color: "sky" },
        { group: "Activity", label: "Agent time", value: formatDuration(summary?.trackedMs ?? 0), detail: "active runtime", color: "sage" },
        { group: "Activity", label: "Tokens", value: compactNumber.format(summary?.totalTokens ?? 0), detail: `${compactNumber.format(summary?.outputTokens ?? 0)} output`, color: "sky" },
        { group: "Activity", label: "Cost", value: money.format(summary?.cost ?? 0), detail: "provider reported", color: "honey" },
        { group: "Efficiency", label: "Cache read", value: formatPercent(cacheRate), detail: `${compactNumber.format(summary?.cacheReadTokens ?? 0)} tokens`, progress: cacheRate * 100, color: "sky" },
        { group: "Efficiency", label: "Tool success", value: toolSuccess.value, detail: toolSuccess.detail, progress: toolSuccess.progress, color: "sage" }
      ]} />
      <Suspense fallback={<ChartsFallback />}>
        <OverviewCharts dashboard={dashboard} metric={trendMetric} onMetricChange={onTrendMetricChange} />
      </Suspense>
    </Stack>
  )
}

function Analytics({ dashboard, toolSuccess, section, onSectionChange }: {
  readonly dashboard: DashboardResponse | undefined
  readonly toolSuccess: ReturnType<typeof toolSuccessPresentation>
  readonly section: AnalyticsSection
  readonly onSectionChange: (section: AnalyticsSection) => void
}) {
  const summary = dashboard?.summary
  const summaryStrip = (
    <InstrumentStrip metrics={[
      { group: "Event activity", label: "Tool calls", value: integer.format(summary?.toolCalls ?? 0), detail: summary?.toolCalls ? `${toolSuccess.value} successful` : "No calls", progress: toolSuccess.progress, color: "sage" },
      { group: "Event activity", label: "Compactions", value: integer.format(summary?.compactions ?? 0), detail: "context checkpoints", color: "sky" },
      { group: "Event activity", label: "Goal events", value: integer.format(summary?.goals ?? 0), detail: "lifecycle updates", color: "honey" },
      { group: "Event activity", label: "Sub-agent events", value: integer.format(summary?.subagents ?? 0), detail: "delegated work", color: "sky" }
    ]} />
  )

  return (
    <Suspense fallback={<ChartsFallback />}>
      <AnalyticsWorkspace dashboard={dashboard} summary={summaryStrip} section={section} onSectionChange={onSectionChange} />
    </Suspense>
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
                      <ThemeIcon size="sm" variant="light" color="sky" radius="sm"><TerminalWindowIcon /></ThemeIcon>
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

const navigation: ReadonlyArray<{ readonly tab: DashboardTab; readonly label: string; readonly icon: typeof ActivityIcon }> = [
  { tab: "overview", label: "Overview", icon: ActivityIcon },
  { tab: "analytics", label: "Analytics", icon: ChartLineUpIcon },
  { tab: "sessions", label: "Sessions", icon: ListBulletsIcon },
  { tab: "settings", label: "Settings", icon: GearSixIcon }
]

export default function App() {
  const location = useDashboardLocation()
  const { tab, days, sessionId, analyticsSection, trendMetric } = location
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 43.75em)")
  const computedColorScheme = useComputedColorScheme("light")
  const { toggleColorScheme } = useMantineColorScheme()
  const nextColorScheme = computedColorScheme === "dark" ? "light" : "dark"

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
  const lastDashboardRef = useRef<DashboardResponse | undefined>(undefined)

  useEffect(() => {
    if (authQuery.data?.authenticated !== true) lastDashboardRef.current = undefined
  }, [authQuery.data?.authenticated])

  useEffect(() => {
    if (dashboardQuery.data && !dashboardQuery.isPlaceholderData) lastDashboardRef.current = dashboardQuery.data
  }, [dashboardQuery.data, dashboardQuery.isPlaceholderData])

  useEffect(() => {
    const keepFocusVisible = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.closest("#dashboard-main") || !window.matchMedia("(max-width: 43.74em)").matches) return

      requestAnimationFrame(() => {
        const mobileNavigation = document.querySelector<HTMLElement>(".mobile-bottom-nav")
        if (!mobileNavigation) return
        const targetBounds = target.getBoundingClientRect()
        const navigationBounds = mobileNavigation.getBoundingClientRect()
        if (targetBounds.bottom > navigationBounds.top - 8) target.scrollIntoView({ block: "center" })
      })
    }

    document.addEventListener("focusin", keepFocusVisible)
    return () => document.removeEventListener("focusin", keepFocusVisible)
  }, [])

  if (authQuery.isPending) {
    return <Center mih="100vh"><Stack align="center" gap="sm"><Loader type="dots" /><Text size="sm" c="dimmed">Loading Koliko</Text></Stack></Center>
  }
  if (authQuery.isError) {
    return (
      <Center mih="100vh">
        <Alert color="rust" icon={<WarningCircleIcon />} title="Koliko could not be loaded">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(authQuery.error, "Authentication status could not be loaded")}</Text>
            <Button variant="light" onClick={() => void authQuery.refetch()}>Retry</Button>
          </Stack>
        </Alert>
      </Center>
    )
  }
  if (!authQuery.data.authenticated) {
    return (
      <Login
        hasPasskey={authQuery.data.hasPasskey}
        colorScheme={computedColorScheme}
        onToggleColorScheme={toggleColorScheme}
      />
    )
  }

  const dashboard = dashboardQuery.data ?? lastDashboardRef.current
  const summary = dashboard?.summary
  const cacheDenominator = (summary?.inputTokens ?? 0) + (summary?.cacheReadTokens ?? 0)
  const cacheRate = cacheDenominator === 0 ? 0 : (summary?.cacheReadTokens ?? 0) / cacheDenominator
  const toolSuccess = toolSuccessPresentation(summary?.toolCalls ?? 0, summary?.toolErrors ?? 0)
  const page = pageTitles[tab]

  const navigate = (next: DashboardTab) => {
    navigateDashboard({ ...location, tab: next, sessionId: undefined })
  }

  const followNavigation = (event: MouseEvent<HTMLElement>, next: DashboardTab) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(next)
  }

  const updateDays = (nextDays: number) => {
    navigateDashboard({ ...location, days: nextDays as typeof days })
  }

  return (
    <AppShell
      layout="alt"
      header={{ height: 58 }}
      navbar={{ width: isDesktop && desktopCollapsed ? 68 : 230, breakpoint: "sm", collapsed: { mobile: true } }}
      padding={0}
      transitionDuration={260}
      transitionTimingFunction="cubic-bezier(0.4, 0, 0.2, 1)"
      className="app-shell"
    >
      <a className="skip-link" href="#dashboard-main">Skip to dashboard content</a>

      <AppShell.Header className="app-header">
        <Group h="100%" px={{ base: "md", sm: "lg" }} justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Box hiddenFrom="sm" className="mobile-header-brand"><Brand /></Box>
            <Title order={2} className="page-heading">{page.title}</Title>
          </Group>

          <Group gap="sm" wrap="nowrap" className="header-actions">
            {tab !== "settings" && (
              <>
                <SegmentedControl
                  size="xs"
                  value={String(days)}
                  aria-label="Date range"
                  onChange={(value) => updateDays(Number(value))}
                  data={[7, 30, 90].map((value) => ({ value: String(value), label: `${value}d` }))}
                  className="range-control header-range-control"
                />
                <Tooltip label="Refresh dashboard">
                  <ActionIcon className="header-refresh" variant="default" size="lg" aria-label="Refresh dashboard" loading={dashboardQuery.isFetching} onClick={() => void dashboardQuery.refetch()}>
                    <ArrowClockwiseIcon />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            <Group gap="xs" wrap="nowrap" className="appearance-controls">
              <Tooltip label={`Use ${nextColorScheme} theme`}>
                <ActionIcon variant="default" size="lg" aria-label={`Use ${nextColorScheme} theme`} onClick={toggleColorScheme}>
                  {computedColorScheme === "dark" ? <SunIcon /> : <MoonIcon />}
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={0} visibleFrom="sm" className="app-navbar" data-desktop-collapsed={desktopCollapsed}>
        <AppShell.Section className="navbar-brand"><Brand /></AppShell.Section>
        <AppShell.Section grow component={ScrollArea} scrollbars="y" className="navbar-navigation">
          <Stack gap={6}>
            {navigation.map((item) => (
              <Tooltip key={item.tab} label={item.label} position="right" disabled={!desktopCollapsed}>
                <NavLink
                  component="a"
                  href={dashboardHref({ ...location, tab: item.tab, sessionId: undefined })}
                  label={item.label}
                  leftSection={<item.icon size={19} weight={tab === item.tab ? "bold" : "regular"} />}
                  active={tab === item.tab}
                  aria-label={item.label}
                  aria-current={tab === item.tab ? "page" : undefined}
                  onClick={(event) => followNavigation(event, item.tab)}
                  variant="light"
                  className="nav-item"
                />
              </Tooltip>
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section className="navbar-footer">
          <Stack gap={4} className="navbar-footer-actions">
            <Tooltip label="View on GitHub" position="right" disabled={!desktopCollapsed}>
              <UnstyledButton
                component="a"
                href="https://github.com/angristan/koliko"
                target="_blank"
                rel="noreferrer"
                className="sidebar-footer-action"
                aria-label="View on GitHub"
              >
                <GithubLogoIcon size={18} />
                <span>GitHub</span>
              </UnstyledButton>
            </Tooltip>
            <Tooltip label="Expand sidebar" position="right" disabled={!desktopCollapsed}>
              <UnstyledButton
                className="sidebar-footer-action"
                aria-label={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setDesktopCollapsed((collapsed) => !collapsed)}
              >
                <SidebarSimpleIcon size={18} />
                <span>Collapse sidebar</span>
              </UnstyledButton>
            </Tooltip>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main id="dashboard-main" tabIndex={-1}>
        <Box className="content-shell">
          <Box className="content-intro">
            <Title order={1} className="content-title">{page.title}</Title>
            {page.description && <Text c="dimmed" mt={6}>{page.description}</Text>}
          </Box>

          {tab !== "settings" && (
            <Group hiddenFrom="sm" gap="xs" wrap="nowrap" className="mobile-page-toolbar">
              <SegmentedControl
                size="xs"
                value={String(days)}
                aria-label="Date range"
                onChange={(value) => updateDays(Number(value))}
                data={[7, 30, 90].map((value) => ({ value: String(value), label: `${value}d` }))}
                className="range-control mobile-range-control"
                fullWidth
              />
              <Tooltip label="Refresh dashboard">
                <ActionIcon variant="default" size="md" aria-label="Refresh dashboard" loading={dashboardQuery.isFetching} onClick={() => void dashboardQuery.refetch()}>
                  <ArrowClockwiseIcon />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}

          {dashboardQuery.error !== null && dashboard ? (
            <Alert color="rust" icon={<WarningCircleIcon />} title="Showing stale data" mb="lg">
              {retainedRangeMessage(range, dashboard)}
            </Alert>
          ) : dashboardQuery.error !== null ? (
            <Alert color="rust" icon={<WarningCircleIcon />} title="Dashboard unavailable" mb="lg">{errorMessage(dashboardQuery.error, "Dashboard could not be loaded")}</Alert>
          ) : dashboardQuery.isPlaceholderData && dashboard ? (
            <Alert color="sky" icon={<ArrowClockwiseIcon />} title="Updating range" mb="lg">
              {loadingRangeMessage(range, dashboard)}
            </Alert>
          ) : null}
          <Box key={tab} className="page-content">
            {dashboardQuery.isPending && tab !== "settings"
              ? <Center mih={320}><Loader type="dots" /></Center>
              : dashboard === undefined && tab !== "settings"
                ? null
              : (
                <>
                  {tab === "overview" && (
                    <Overview
                      dashboard={dashboard}
                      cacheRate={cacheRate}
                      toolSuccess={toolSuccess}
                      trendMetric={trendMetric}
                      onTrendMetricChange={(metric) => navigateDashboard({ ...location, trendMetric: metric })}
                    />
                  )}
                  {tab === "analytics" && (
                    <Analytics
                      dashboard={dashboard}
                      toolSuccess={toolSuccess}
                      section={analyticsSection}
                      onSectionChange={(section) => navigateDashboard({ ...location, analyticsSection: section })}
                    />
                  )}
                  {tab === "sessions" && (
                    <Sessions
                      dashboard={dashboard}
                      setSessionId={(nextSessionId) => navigateDashboard({ ...location, sessionId: nextSessionId })}
                    />
                  )}
                  {tab === "settings" && <Settings />}
                </>
              )}
          </Box>
        </Box>
      </AppShell.Main>

      <Box component="nav" hiddenFrom="sm" className="mobile-bottom-nav" aria-label="Primary navigation">
        {navigation.map((item) => {
          const active = tab === item.tab
          return (
            <UnstyledButton
              component="a"
              href={dashboardHref({ ...location, tab: item.tab, sessionId: undefined })}
              key={item.tab}
              className="mobile-bottom-nav-item"
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
              onClick={(event) => followNavigation(event, item.tab)}
            >
              <item.icon size={20} weight={active ? "bold" : "regular"} aria-hidden="true" />
              <span>{item.label}</span>
            </UnstyledButton>
          )
        })}
      </Box>

      <SessionDrawer
        opened={sessionId !== undefined}
        detail={sessionQuery.data}
        pending={sessionQuery.isPending}
        error={sessionQuery.error}
        onClose={() => navigateDashboard({ ...location, sessionId: undefined })}
        onRetry={() => { void sessionQuery.refetch() }}
      />
    </AppShell>
  )
}
