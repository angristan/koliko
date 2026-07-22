import { resolve } from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers"
import { defineConfig, defineProject } from "vitest/config"

const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"))

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: "unit",
          include: ["tests/*.test.ts"]
        }
      }),
      defineProject({
        plugins: [
          cloudflareTest({
            main: "./src/worker/index.ts",
            miniflare: {
              compatibilityDate: "2026-07-22",
              compatibilityFlags: ["nodejs_compat"],
              d1Databases: ["DB"],
              bindings: {
                RP_NAME: "Traker",
                RP_ID: "example.test",
                EXPECTED_ORIGIN: "https://example.test",
                BOOTSTRAP_TOKEN: "test-bootstrap-token-with-sufficient-entropy",
                SESSION_SECRET: "test-session-secret-with-sufficient-entropy"
              }
            }
          })
        ],
        define: {
          TEST_D1_MIGRATIONS: JSON.stringify(migrations)
        },
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["tests/worker/setup.ts"]
        }
      })
    ],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
})
