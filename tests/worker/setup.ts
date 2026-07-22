import { env } from "cloudflare:workers"
import { applyD1Migrations, type D1Migration } from "cloudflare:test"
import { beforeAll, beforeEach } from "vitest"

declare const TEST_D1_MIGRATIONS: D1Migration[]

beforeAll(async () => {
  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS)
})

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM telemetry_events"),
    env.DB.prepare("DELETE FROM auth_challenges"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM passkeys")
  ])
})
