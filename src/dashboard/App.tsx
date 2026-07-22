import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import { ClipboardText } from "@cloudflare/kumo/components/clipboard-text"
import { Input } from "@cloudflare/kumo/components/input"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Sidebar } from "@cloudflare/kumo/components/sidebar"
import { Table } from "@cloudflare/kumo/components/table"
import { Tabs } from "@cloudflare/kumo/components/tabs"
import {
  ActivityIcon,
  ArrowClockwiseIcon,
  ChatsCircleIcon,
  CoinsIcon,
  CurrencyDollarIcon,
  DatabaseIcon,
  GearSixIcon,
  GithubLogoIcon,
  KeyIcon,
  ListBulletsIcon,
  ShieldCheckIcon,
  SignOutIcon,
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

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat("en")
const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
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
  overview: { title: "Overview", description: "Sessions, tokens, runtime, and cost" },
  features: { title: "Agent features", description: "Tools, reasoning, compaction, goals, and delegation" },
  sessions: { title: "Sessions", description: "Recent agent activity and event metadata" },
  settings: { title: "Settings", description: "Collector keys, passkeys, and privacy" }
}

function LogoMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 11.5 5.5 8l3 2 5.5-6" />
      <circle cx="2" cy="11.5" r="1" />
      <circle cx="5.5" cy="8" r="1" />
      <circle cx="8.5" cy="10" r="1" />
      <circle cx="14" cy="4" r="1" />
    </svg>
  )
}

const metricVisuals: Readonly<Record<string, { readonly icon: ReactNode; readonly tone: string }>> = {
  Sessions: { icon: <ChatsCircleIcon />, tone: "blue" },
  "Agent time": { icon: <TimerIcon />, tone: "purple" },
  Tokens: { icon: <CoinsIcon />, tone: "orange" },
  Cost: { icon: <CurrencyDollarIcon />, tone: "green" },
  "Cache read": { icon: <DatabaseIcon />, tone: "teal" },
  "Tool success": { icon: <WrenchIcon />, tone: "pink" },
  "Tool calls": { icon: <WrenchIcon />, tone: "blue" },
  Compactions: { icon: <DatabaseIcon />, tone: "orange" },
  "Goal events": { icon: <ActivityIcon />, tone: "green" },
  "Sub-agent events": { icon: <ChatsCircleIcon />, tone: "purple" }
}

function MetricStrip({
  metrics
}: {
  readonly metrics: ReadonlyArray<{
    readonly label: string
    readonly value: string
    readonly detail?: string
  }>
}) {
  return (
    <section className="metric-strip" data-count={metrics.length} aria-label="Summary metrics">
      {metrics.map((metric) => {
        const visual = metricVisuals[metric.label] ?? { icon: <ActivityIcon />, tone: "blue" }
        return (
          <LayerCard className={`metric metric-${visual.tone}`} key={metric.label}>
            <span className="metric-icon">{visual.icon}</span>
            <div className="metric-copy">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail && <small>{metric.detail}</small>}
            </div>
          </LayerCard>
        )
      })}
    </section>
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
    <LayerCard className={`panel ${className}`.trim()}>
      <LayerCard.Secondary className="panel-header">
        <h2>{title}</h2>
        {detail && <span>{detail}</span>}
      </LayerCard.Secondary>
      <LayerCard.Primary className="panel-body">{children}</LayerCard.Primary>
    </LayerCard>
  )
}

function ActivityChart({ data }: { readonly data: DashboardResponse["daily"] }) {
  const width = 840
  const height = 260
  const margin = { top: 18, right: 18, bottom: 34, left: 54 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const rawMax = Math.max(0, ...data.map((day) => day.tokens))
  const magnitude = rawMax === 0 ? 1 : 10 ** Math.floor(Math.log10(rawMax))
  const max = Math.max(1, Math.ceil(rawMax / magnitude) * magnitude)
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const points = data.map((day, index) => ({
    day,
    x: margin.left + (data.length === 1 ? chartWidth / 2 : index / (data.length - 1) * chartWidth),
    y: margin.top + chartHeight - day.tokens / max * chartHeight
  }))
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")
  const areaPath = points.length === 0
    ? ""
    : `M${points[0]!.x},${margin.top + chartHeight} L${points[0]!.x},${points[0]!.y} ${points.slice(1).map((point) => `L${point.x},${point.y}`).join(" ")} L${points.at(-1)!.x},${margin.top + chartHeight} Z`
  const labelIndexes = new Set([0, ...[0.25, 0.5, 0.75, 1].map((fraction) => Math.round((data.length - 1) * fraction))])
  const total = data.reduce((sum, day) => sum + day.tokens, 0)
  const formatDay = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  })

  return (
    <Panel title="Token usage" detail={`${compactNumber.format(total)} tokens total`} className="chart-panel">
      {data.length === 0 || rawMax === 0 ? (
        <div className="empty-state">No token usage in this range.</div>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily token usage line chart">
            {ticks.map((fraction) => {
              const y = margin.top + chartHeight - chartHeight * fraction
              return (
                <g key={fraction}>
                  <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid" />
                  <text x={margin.left - 10} y={y + 4} textAnchor="end" className="chart-label">
                    {compactNumber.format(max * fraction)}
                  </text>
                </g>
              )
            })}
            <path d={areaPath} className="chart-area" />
            <path d={linePath} className="chart-line" />
            {points.map(({ day, x, y }, index) => (
              <g key={day.date} className={index === points.length - 1 ? "chart-point current" : "chart-point"}>
                <circle cx={x} cy={y} r="3" />
                <circle cx={x} cy={y} r="10" className="chart-hit-area">
                  <title>{day.date}: {integer.format(day.tokens)} tokens · {money.format(day.cost)}</title>
                </circle>
                {labelIndexes.has(index) && (
                  <text x={x} y={height - 7} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} className="chart-label">
                    {formatDay(day.date)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
    </Panel>
  )
}

function UsageTable({ rows }: { readonly rows: ReadonlyArray<UsageBreakdown> }) {
  if (rows.length === 0) return <div className="empty-state compact">No data in this range.</div>

  return (
    <div className="table-scroll">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Sessions</Table.Head>
            <Table.Head>Turns</Table.Head>
            <Table.Head>Tokens</Table.Head>
            <Table.Head>Cost</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.slice(0, 10).map((row) => (
            <Table.Row key={row.key}>
              <Table.Cell><code>{row.label}</code></Table.Cell>
              <Table.Cell>{integer.format(row.sessions)}</Table.Cell>
              <Table.Cell>{integer.format(row.turns)}</Table.Cell>
              <Table.Cell>{compactNumber.format(row.tokens)}</Table.Cell>
              <Table.Cell>{money.format(row.cost)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
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
      <section className="auth-panel">
        <div className="auth-brand"><span><LogoMark /></span><strong>traker</strong></div>
        <div className="auth-copy">
          <h1>{hasPasskey ? "Sign in" : "Set up Traker"}</h1>
          <p>{hasPasskey ? "Authenticate with your passkey to continue." : "Enter the bootstrap token and register your first passkey."}</p>
        </div>
        {error && <div className="error-banner"><WarningCircleIcon />{error}</div>}
        {!hasPasskey && (
          <Input
            label="Bootstrap token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            placeholder="BOOTSTRAP_TOKEN"
          />
        )}
        <Button
          variant="primary"
          loading={busy}
          disabled={!hasPasskey && token.length === 0}
          onClick={() => void act()}
          icon={<ShieldCheckIcon />}
        >
          {hasPasskey ? "Continue with passkey" : "Register passkey"}
        </Button>
        <p className="auth-note">Prompts, responses, source code, tool arguments, and full paths are never collected.</p>
      </section>
    </main>
  )
}

function SessionDetails({ detail, onClose }: { readonly detail: SessionDetailResponse; readonly onClose: () => void }) {
  return (
    <Panel
      title={detail.repository}
      detail={detail.truncated ? `${detail.events.length} latest events` : `${detail.events.length} events`}
      className="event-log-panel"
    >
      <div className="event-log-actions">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      {detail.truncated && <div className="notice">Showing the latest 500 events.</div>}
      <div className="event-log">
        {detail.events.map((event) => (
          <div className="event-row" key={event.id}>
            <time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <strong>{event.type.replaceAll("_", " ")}</strong>
            <div className="event-values">
              {event.toolName && <code>{event.toolName}</code>}
              {event.model && <span>{event.provider}/{event.model}</span>}
              {event.tokens !== undefined && <span>{compactNumber.format(event.tokens)} tokens</span>}
              {event.cost !== undefined && <span>{money.format(event.cost)}</span>}
              {event.durationMs !== undefined && <span>{formatDuration(event.durationMs)}</span>}
              {event.status === "error" && <span className="error-label">error</span>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
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
    <div className="settings-layout">
      <Panel title="Collector API keys" detail="Ingestion authentication" className="settings-main">
        <p className="panel-description">Create one revocable key for each coding-agent collector. Only key hashes are stored.</p>
        {message && <div className="notice">{message}</div>}
        {createdKey && <ClipboardText text={createdKey} />}
        <div className="key-create">
          <Input label="Key name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          <Button variant="primary" loading={busy} onClick={() => void create()} icon={<KeyIcon />}>Create key</Button>
        </div>
        <div className="key-list">
          {keys.map((key) => (
            <div key={key.id} className="key-row">
              <div>
                <strong>{key.name}</strong>
                <small>{key.prefix}… · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</small>
              </div>
              {key.revokedAt
                ? <span className="muted-label">revoked</span>
                : <Button variant="secondary-destructive" size="sm" onClick={() => void revokeApiKey(key.id).then(refresh)}>Revoke</Button>}
            </div>
          ))}
          {keys.length === 0 && <div className="empty-state compact">No API keys.</div>}
        </div>
      </Panel>

      <div className="settings-side">
        <Panel title="Passkeys">
          <p className="panel-description">User verification is required for every dashboard sign-in.</p>
          <div className="button-stack">
            <Button variant="secondary" onClick={() => void registerPasskey().then(() => setMessage("Passkey added."))} icon={<ShieldCheckIcon />}>Add passkey</Button>
            <Button variant="ghost" onClick={() => void logout().then(onLogout)} icon={<SignOutIcon />}>Sign out</Button>
          </div>
        </Panel>

        <Panel title="Privacy">
          <dl className="privacy-list">
            <div><dt>Collected</dt><dd>Usage counts, models, timing, cost, and lifecycle metadata.</dd></div>
            <div><dt>Excluded</dt><dd>Prompts, responses, source code, arguments, output, and paths.</dd></div>
            <div><dt>Repository</dt><dd>Folder name only.</dd></div>
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function Overview({ dashboard, cacheRate, toolSuccess }: {
  readonly dashboard: DashboardResponse | undefined
  readonly cacheRate: number
  readonly toolSuccess: number
}) {
  const summary = dashboard?.summary
  return (
    <>
      <MetricStrip metrics={[
        { label: "Sessions", value: integer.format(summary?.sessions ?? 0), detail: `${integer.format(summary?.turns ?? 0)} turns` },
        { label: "Agent time", value: formatDuration(summary?.trackedMs ?? 0), detail: "active runtime" },
        { label: "Tokens", value: compactNumber.format(summary?.totalTokens ?? 0), detail: `${compactNumber.format(summary?.outputTokens ?? 0)} output` },
        { label: "Cost", value: money.format(summary?.cost ?? 0), detail: "provider reported" },
        { label: "Cache read", value: formatPercent(cacheRate), detail: `${compactNumber.format(summary?.cacheReadTokens ?? 0)} tokens` },
        { label: "Tool success", value: formatPercent(toolSuccess), detail: `${integer.format(summary?.toolCalls ?? 0)} calls` }
      ]} />
      <ActivityChart data={dashboard?.daily ?? []} />
      <div className="panel-grid two">
        <Panel title="Models" detail="By token volume"><UsageTable rows={dashboard?.models ?? []} /></Panel>
        <Panel title="Repositories" detail="Folder names"><UsageTable rows={dashboard?.repositories ?? []} /></Panel>
      </div>
    </>
  )
}

function Features({ dashboard, toolSuccess }: { readonly dashboard: DashboardResponse | undefined; readonly toolSuccess: number }) {
  const summary = dashboard?.summary
  return (
    <>
      <MetricStrip metrics={[
        { label: "Tool calls", value: integer.format(summary?.toolCalls ?? 0), detail: `${formatPercent(toolSuccess)} successful` },
        { label: "Compactions", value: integer.format(summary?.compactions ?? 0), detail: "context checkpoints" },
        { label: "Goal events", value: integer.format(summary?.goals ?? 0), detail: "lifecycle updates" },
        { label: "Sub-agent events", value: integer.format(summary?.subagents ?? 0), detail: "delegated work" }
      ]} />
      <div className="panel-grid two">
        <Panel title="Thinking levels" detail="Usage distribution"><UsageTable rows={dashboard?.thinking ?? []} /></Panel>
        <Panel title="Feature events" detail="Lifecycle counts">
          <div className="feature-list">
            {dashboard?.features.map((feature) => (
              <div className="feature-row" key={`${feature.feature}-${feature.label}`}>
                <span>{feature.feature}</span>
                <strong>{feature.label.replaceAll("_", " ")}</strong>
                <small>{feature.detail}</small>
                <b>{integer.format(feature.count)}</b>
              </div>
            ))}
            {(dashboard?.features.length ?? 0) === 0 && <div className="empty-state compact">No feature events.</div>}
          </div>
        </Panel>
      </div>
      <Panel title="Tool performance" detail="Top 50 tools">
        <div className="table-scroll">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Tool</Table.Head>
                <Table.Head>Calls</Table.Head>
                <Table.Head>Errors</Table.Head>
                <Table.Head>Total time</Table.Head>
                <Table.Head>Success rate</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {dashboard?.tools.map((tool) => (
                <Table.Row key={tool.name}>
                  <Table.Cell><code>{tool.name}</code></Table.Cell>
                  <Table.Cell>{integer.format(tool.calls)}</Table.Cell>
                  <Table.Cell>{integer.format(tool.errors)}</Table.Cell>
                  <Table.Cell>{formatDuration(tool.durationMs)}</Table.Cell>
                  <Table.Cell>{formatPercent(tool.calls === 0 ? 1 : 1 - tool.errors / tool.calls)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </Panel>
    </>
  )
}

function Sessions({ dashboard, session, setSession }: {
  readonly dashboard: DashboardResponse | undefined
  readonly session: SessionDetailResponse | undefined
  readonly setSession: (session: SessionDetailResponse | undefined) => void
}) {
  return (
    <>
      <Panel title="Recent sessions" detail="Latest 50">
        <div className="table-scroll">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Repository</Table.Head>
                <Table.Head>Last activity</Table.Head>
                <Table.Head>Model</Table.Head>
                <Table.Head>Turns</Table.Head>
                <Table.Head>Tokens</Table.Head>
                <Table.Head>Cost</Table.Head>
                <Table.Head />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {dashboard?.sessions.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell><strong>{row.repository}</strong></Table.Cell>
                  <Table.Cell>{new Date(row.endedAt).toLocaleString()}</Table.Cell>
                  <Table.Cell><code>{row.model}</code></Table.Cell>
                  <Table.Cell>{integer.format(row.turns)}</Table.Cell>
                  <Table.Cell>{compactNumber.format(row.tokens)}</Table.Cell>
                  <Table.Cell>{money.format(row.cost)}</Table.Cell>
                  <Table.Cell><Button size="sm" variant="ghost" onClick={() => void getSession(row.id).then(setSession)}>Inspect</Button></Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </Panel>
      {session && <SessionDetails detail={session} onClose={() => setSession(undefined)} />}
    </>
  )
}

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

  if (auth.loading) return <main className="auth-shell"><span className="loading-label">Loading Traker…</span></main>
  if (!auth.authenticated) return <Login hasPasskey={auth.hasPasskey} onAuthenticated={() => void refreshAuth()} />

  const summary = dashboard?.summary
  const cacheDenominator = (summary?.inputTokens ?? 0) + (summary?.cacheReadTokens ?? 0)
  const cacheRate = cacheDenominator === 0 ? 0 : (summary?.cacheReadTokens ?? 0) / cacheDenominator
  const toolSuccess = (summary?.toolCalls ?? 0) === 0
    ? 1
    : 1 - (summary?.toolErrors ?? 0) / (summary?.toolCalls ?? 1)
  const page = pageTitles[tab]

  return (
    <Sidebar.Provider defaultOpen collapsible="icon" mobileBreakpoint={620} className="app-shell">
      <Sidebar className="app-sidebar">
        <Sidebar.Header className="app-sidebar-header">
          <div className="wordmark"><span><LogoMark /></span><strong>traker</strong></div>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.Menu>
              <Sidebar.MenuButton icon={ActivityIcon} active={tab === "overview"} tooltip="Overview" onClick={() => setTab("overview")}>Overview</Sidebar.MenuButton>
              <Sidebar.MenuButton icon={TerminalWindowIcon} active={tab === "features"} tooltip="Agent features" onClick={() => setTab("features")}>Agent features</Sidebar.MenuButton>
              <Sidebar.MenuButton icon={ListBulletsIcon} active={tab === "sessions"} tooltip="Sessions" onClick={() => setTab("sessions")}>Sessions</Sidebar.MenuButton>
              <Sidebar.MenuButton icon={GearSixIcon} active={tab === "settings"} tooltip="Settings" onClick={() => setTab("settings")}>Settings</Sidebar.MenuButton>
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer className="app-sidebar-footer">
          <Sidebar.Menu>
            <Sidebar.MenuButton icon={GithubLogoIcon} href="https://github.com/angristan/traker" tooltip="GitHub">GitHub</Sidebar.MenuButton>
          </Sidebar.Menu>
          <Sidebar.Trigger />
        </Sidebar.Footer>
      </Sidebar>

      <div className="workspace">
        <header className="page-header">
          <div className="page-heading">
            <Sidebar.Trigger className="header-sidebar-trigger" />
            <div><h1>{page.title}</h1><p>{page.description}</p></div>
          </div>
          {tab !== "settings" && (
            <div className="header-controls">
              <Tabs
                variant="segmented"
                size="sm"
                tabs={[7, 30, 90].map((value) => ({ value: String(value), label: `${value}d` }))}
                value={String(days)}
                onValueChange={(value) => setDays(Number(value))}
              />
              <Button shape="square" size="sm" variant="secondary" aria-label="Refresh dashboard" loading={loading} onClick={() => void refreshDashboard()}>
                <ArrowClockwiseIcon />
              </Button>
            </div>
          )}
        </header>

        <main className="content">
          {error && <div className="error-banner"><WarningCircleIcon />{error}</div>}
          {tab === "overview" && <Overview dashboard={dashboard} cacheRate={cacheRate} toolSuccess={toolSuccess} />}
          {tab === "features" && <Features dashboard={dashboard} toolSuccess={toolSuccess} />}
          {tab === "sessions" && <Sessions dashboard={dashboard} session={session} setSession={setSession} />}
          {tab === "settings" && <Settings onLogout={() => setAuth({ loading: false, authenticated: false, hasPasskey: true })} />}
        </main>
      </div>
    </Sidebar.Provider>
  )
}
