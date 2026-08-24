import { env } from "cloudflare:workers"
import { applyD1Migrations, type D1Migration } from "cloudflare:test"
import { beforeAll, beforeEach } from "vitest"

declare const TEST_D1_MIGRATIONS: D1Migration[]

beforeAll(async () => {
  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS)
})

beforeEach(async () => {
  // telemetry_events is append-only in production, so rollups intentionally have
  // no DELETE triggers. Tests clear both the source rows and derived state.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM telemetry_events"),
    env.DB.prepare("DELETE FROM telemetry_daily_metrics"),
    env.DB.prepare("DELETE FROM telemetry_daily_session_metrics"),
    env.DB.prepare("DELETE FROM telemetry_daily_dimensions"),
    env.DB.prepare("DELETE FROM telemetry_daily_dimension_sessions"),
    env.DB.prepare("DELETE FROM telemetry_daily_tools"),
    env.DB.prepare("DELETE FROM telemetry_daily_features"),
    env.DB.prepare("DELETE FROM telemetry_session_models"),
    env.DB.prepare("DELETE FROM auth_challenges"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM passkeys")
  ])
})
