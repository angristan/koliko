import { readFile } from "node:fs/promises"

const config = JSON.parse(await readFile("wrangler.production.jsonc", "utf8")) as {
  readonly vars?: { readonly EXPECTED_ORIGIN?: unknown }
}
const origin = config.vars?.EXPECTED_ORIGIN
if (typeof origin !== "string" || !origin.startsWith("https://")) {
  throw new Error("Production EXPECTED_ORIGIN must be an HTTPS origin")
}

const statusResponse = await fetch(`${origin}/api/auth/status`)
if (!statusResponse.ok) {
  throw new Error(`Production auth status returned HTTP ${statusResponse.status}`)
}
const status: unknown = await statusResponse.json()
if (
  typeof status !== "object"
  || status === null
  || typeof (status as { authenticated?: unknown }).authenticated !== "boolean"
  || typeof (status as { hasPasskey?: unknown }).hasPasskey !== "boolean"
) {
  throw new Error("Production auth status response is invalid")
}

const dashboardResponse = await fetch(origin)
if (!dashboardResponse.ok) {
  throw new Error(`Production dashboard returned HTTP ${dashboardResponse.status}`)
}
for (const header of [
  "content-security-policy",
  "permissions-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options"
]) {
  if (!dashboardResponse.headers.has(header)) {
    throw new Error(`Production dashboard is missing ${header}`)
  }
}
await dashboardResponse.body?.cancel()

console.log("Production smoke checks passed")
