import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ActionIcon, Alert, AppShell, Box, Center, Group, Loader, NavLink, ScrollArea, SegmentedControl, Stack, Text, Title, Tooltip, UnstyledButton,
  useComputedColorScheme, useMantineColorScheme
} from "@mantine/core"
import { useMediaQuery } from "@mantine/hooks"
import {
  ActivityIcon, ArrowClockwiseIcon, ChartLineUpIcon, GearSixIcon, GithubLogoIcon, ListBulletsIcon, MoonIcon, SidebarSimpleIcon, SunIcon, WarningCircleIcon
} from "@phosphor-icons/react"
import type { DashboardResponse } from "../../shared/api"
import { Brand } from "../components/Brand"
import { AnalyticsPage } from "../features/analytics/AnalyticsPage"
import { OverviewPage } from "../features/overview/OverviewPage"
import { SessionDrawer } from "../features/sessions/SessionDrawer"
import { SessionsPage } from "../features/sessions/SessionsPage"
import { SettingsPage } from "../features/settings/SettingsPage"
import { errorMessage } from "../formatting"
import {
  dashboardHref, navigateDashboard, useDashboardLocation, type DashboardTab
} from "../navigation"
import { loadingRangeMessage, retainedRangeMessage } from "../presentation"
import { dashboardQueryOptions, sessionQueryOptions } from "../queries"

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)
const rangeForDays = (days: number) => ({
  from: isoDate(new Date(Date.now() - (days - 1) * 86_400_000)),
  to: isoDate(new Date())
})

const pageTitles: Readonly<Record<DashboardTab, { readonly title: string; readonly description?: string }>> = {
  overview: { title: "Overview", description: "See where your agent time, tokens, and spend are going." },
  analytics: { title: "Analytics", description: "Explore usage, cost, tools, sessions, and agent feature trends." },
  sessions: { title: "Sessions", description: "Inspect recent runs and their privacy-safe event metadata." },
  settings: { title: "Settings" }
}

const navigation: ReadonlyArray<{ readonly tab: DashboardTab; readonly label: string; readonly icon: typeof ActivityIcon }> = [
  { tab: "overview", label: "Overview", icon: ActivityIcon },
  { tab: "analytics", label: "Analytics", icon: ChartLineUpIcon },
  { tab: "sessions", label: "Sessions", icon: ListBulletsIcon },
  { tab: "settings", label: "Settings", icon: GearSixIcon }
]

export function Dashboard() {
  const location = useDashboardLocation()
  const { tab, days, sessionId, analyticsSection, trendMetric } = location
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const isDesktop = useMediaQuery("(min-width: 43.75em)")
  const computedColorScheme = useComputedColorScheme("light")
  const { toggleColorScheme } = useMantineColorScheme()
  const nextColorScheme = computedColorScheme === "dark" ? "light" : "dark"

  const range = useMemo(() => rangeForDays(days), [days])
  const dashboardQuery = useQuery(dashboardQueryOptions(range.from, range.to))
  const sessionQuery = useQuery({
    ...sessionQueryOptions(sessionId ?? ""),
    enabled: sessionId !== undefined
  })
  const lastDashboardRef = useRef<DashboardResponse | undefined>(undefined)


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


  const dashboard = dashboardQuery.data ?? lastDashboardRef.current
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
                    <OverviewPage
                      dashboard={dashboard}
                      trendMetric={trendMetric}
                      onTrendMetricChange={(metric) => navigateDashboard({ ...location, trendMetric: metric })}
                    />
                  )}
                  {tab === "analytics" && (
                    <AnalyticsPage
                      dashboard={dashboard}
                      section={analyticsSection}
                      onSectionChange={(section) => navigateDashboard({ ...location, analyticsSection: section })}
                    />
                  )}
                  {tab === "sessions" && (
                    <SessionsPage
                      dashboard={dashboard}
                      setSessionId={(nextSessionId) => navigateDashboard({ ...location, sessionId: nextSessionId })}
                    />
                  )}
                  {tab === "settings" && <SettingsPage />}
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
