import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readConfig = async (path: string): Promise<Readonly<Record<string, unknown>>> => {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${path} must contain an object`)
  return parsed
}

describe.each([
  "wrangler.jsonc",
  "wrangler.production.jsonc.example"
])("%s", (path) => {
  it("keeps static assets at the edge and smart-places only API requests", async () => {
    const config = await readConfig(path)
    expect(config.placement).toEqual({ mode: "smart" })
    expect(config.assets).toEqual({
      directory: "./dist",
      run_worker_first: ["/api/*"],
      not_found_handling: "single-page-application"
    })
  })
})

describe("static asset headers", () => {
  it("preserves every dashboard security policy without Worker execution", async () => {
    const headers = await readFile("public/_headers", "utf8")

    expect(headers).toContain("Content-Security-Policy: default-src 'self'")
    expect(headers).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=()")
    expect(headers).toContain("Referrer-Policy: no-referrer")
    expect(headers).toContain("X-Content-Type-Options: nosniff")
    expect(headers).toContain("X-Frame-Options: DENY")
  })
})
