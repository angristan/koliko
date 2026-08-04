import { describe, expect, it } from "vitest"
import { dashboardHref, parseDashboardUrl, type DashboardLocation } from "../src/dashboard/navigation"

const defaults: DashboardLocation = {
  tab: "overview",
  days: 30,
  analyticsSection: "usage",
  trendMetric: "tokens"
}

describe("dashboard URLs", () => {
  it("parses pages, sections, filters, and selected sessions", () => {
    expect(parseDashboardUrl("/analytics/tools?days=90")).toEqual({
      ...defaults,
      tab: "analytics",
      days: 90,
      analyticsSection: "tools"
    })
    expect(parseDashboardUrl("/sessions/session_123?days=7")).toEqual({
      ...defaults,
      tab: "sessions",
      days: 7,
      sessionId: "session_123"
    })
    expect(parseDashboardUrl("/?metric=runtime")).toEqual({
      ...defaults,
      trendMetric: "runtime"
    })
  })

  it("formats canonical direct links", () => {
    expect(dashboardHref({ ...defaults, tab: "settings" })).toBe("/settings")
    expect(dashboardHref({ ...defaults, tab: "analytics", analyticsSection: "features", days: 90 }))
      .toBe("/analytics/features?days=90")
    expect(dashboardHref({ ...defaults, tab: "sessions", sessionId: "session_123" }))
      .toBe("/sessions/session_123")
    expect(dashboardHref({ ...defaults, trendMetric: "cost" })).toBe("/?metric=cost")
  })

  it("falls back safely for unknown routes and values", () => {
    expect(parseDashboardUrl("/unknown?days=365&metric=secret")).toEqual(defaults)
    expect(parseDashboardUrl("/sessions/%ZZ")).toEqual({ ...defaults, tab: "sessions" })
    expect(parseDashboardUrl("/analytics/unknown")).toEqual({
      ...defaults,
      tab: "analytics"
    })
  })
})
