import { useSyncExternalStore } from "react"

export type DashboardTab = "overview" | "analytics" | "sessions" | "settings"
export type AnalyticsSection = "usage" | "cost" | "tools" | "sessions" | "features"
export type TrendMetric = "tokens" | "cost" | "sessions" | "runtime"
export type DashboardDays = 7 | 30 | 90

export interface DashboardLocation {
  readonly tab: DashboardTab
  readonly days: DashboardDays
  readonly analyticsSection: AnalyticsSection
  readonly trendMetric: TrendMetric
  readonly sessionId?: string
}

const dashboardTabs = new Set<DashboardTab>(["overview", "analytics", "sessions", "settings"])
const analyticsSections = new Set<AnalyticsSection>(["usage", "cost", "tools", "sessions", "features"])
const trendMetrics = new Set<TrendMetric>(["tokens", "cost", "sessions", "runtime"])
const dashboardDays = new Set<DashboardDays>([7, 30, 90])
const navigationEvent = "koliko:navigation"

const decodePathSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ""
  }
}

export function parseDashboardUrl(value: string | URL): DashboardLocation {
  const url = value instanceof URL ? value : new URL(value, "https://koliko.local")
  const segments = url.pathname.split("/").filter(Boolean).map(decodePathSegment)
  const tab = dashboardTabs.has(segments[0] as DashboardTab) ? segments[0] as DashboardTab : "overview"
  const requestedDays = Number(url.searchParams.get("days"))
  const days = dashboardDays.has(requestedDays as DashboardDays) ? requestedDays as DashboardDays : 30
  const requestedSection = tab === "analytics" ? segments[1] : undefined
  const analyticsSection = analyticsSections.has(requestedSection as AnalyticsSection)
    ? requestedSection as AnalyticsSection
    : "usage"
  const requestedMetric = url.searchParams.get("metric")
  const trendMetric = trendMetrics.has(requestedMetric as TrendMetric) ? requestedMetric as TrendMetric : "tokens"
  const sessionId = tab === "sessions" && segments[1] ? segments[1] : undefined

  return { tab, days, analyticsSection, trendMetric, sessionId }
}

export function dashboardHref(location: DashboardLocation): string {
  let pathname = "/"
  if (location.tab === "analytics") {
    pathname = location.analyticsSection === "usage" ? "/analytics" : `/analytics/${location.analyticsSection}`
  } else if (location.tab === "sessions") {
    pathname = location.sessionId ? `/sessions/${encodeURIComponent(location.sessionId)}` : "/sessions"
  } else if (location.tab === "settings") {
    pathname = "/settings"
  }

  const search = new URLSearchParams()
  if (location.days !== 30) search.set("days", String(location.days))
  if (location.tab === "overview" && location.trendMetric !== "tokens") search.set("metric", location.trendMetric)
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

const currentUrl = (): string => `${window.location.pathname}${window.location.search}`

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener("popstate", listener)
  window.addEventListener(navigationEvent, listener)
  return () => {
    window.removeEventListener("popstate", listener)
    window.removeEventListener(navigationEvent, listener)
  }
}

export function useDashboardLocation(): DashboardLocation {
  const url = useSyncExternalStore(subscribe, currentUrl, () => "/")
  return parseDashboardUrl(url)
}

export function navigateDashboard(location: DashboardLocation): void {
  const href = dashboardHref(location)
  if (href === currentUrl()) return
  window.history.pushState(null, "", href)
  window.dispatchEvent(new Event(navigationEvent))
}
