import { readFile } from "node:fs/promises"

const config = JSON.parse(await readFile("wrangler.production.jsonc", "utf8")) as {
  readonly vars?: { readonly EXPECTED_ORIGIN?: unknown }
}
const origin = config.vars?.EXPECTED_ORIGIN
if (typeof origin !== "string" || !origin.startsWith("https://")) {
  throw new Error("Production EXPECTED_ORIGIN must be an HTTPS origin")
}

const response = await fetch(`${origin}/api/v1/events`, {
  method: "POST",
  redirect: "manual"
})
if (response.status !== 401) {
  throw new Error(`Production ingestion authentication returned HTTP ${response.status}`)
}

let payload: unknown
try {
  payload = await response.json()
} catch {
  throw new Error("Production ingestion authentication response is not JSON")
}
if (
  typeof payload !== "object"
  || payload === null
  || !("error" in payload)
  || typeof payload.error !== "object"
  || payload.error === null
  || !("code" in payload.error)
  || payload.error.code !== "invalid_api_key"
) {
  throw new Error("Production ingestion authentication response is invalid")
}

console.log("Production smoke checks passed")
