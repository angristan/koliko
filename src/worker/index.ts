import {
  authenticationOptions,
  authStatus,
  createApiKey,
  listApiKeys,
  logout,
  registrationOptions,
  revokeApiKey,
  verifyAuthentication,
  verifyRegistration
} from "./auth"
import { dashboard, sessionDetail } from "./analytics"
import { errorResponse, HttpFailure, json, type WorkerEnv } from "./http"
import { ingestTelemetry } from "./telemetry"

const routeApi = async (request: Request, env: WorkerEnv): Promise<Response> => {
  const url = new URL(request.url)
  const { pathname } = url

  if (request.method === "GET" && pathname === "/api/auth/status") return authStatus(request, env)
  if (request.method === "POST" && pathname === "/api/auth/register/options") return registrationOptions(request, env)
  if (request.method === "POST" && pathname === "/api/auth/register/verify") return verifyRegistration(request, env)
  if (request.method === "POST" && pathname === "/api/auth/login/options") return authenticationOptions(request, env)
  if (request.method === "POST" && pathname === "/api/auth/login/verify") return verifyAuthentication(request, env)
  if (request.method === "POST" && pathname === "/api/auth/logout") return logout(request, env)

  if (request.method === "POST" && pathname === "/api/v1/events") return ingestTelemetry(request, env)
  if (request.method === "GET" && pathname === "/api/dashboard") return dashboard(request, env)
  if (request.method === "GET" && pathname === "/api/keys") return listApiKeys(request, env)
  if (request.method === "POST" && pathname === "/api/keys") return createApiKey(request, env)

  const keyMatch = pathname.match(/^\/api\/keys\/([^/]+)$/u)
  if (request.method === "DELETE" && keyMatch) return revokeApiKey(request, env, decodeURIComponent(keyMatch[1]))

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u)
  if (request.method === "GET" && sessionMatch) {
    return sessionDetail(request, env, decodeURIComponent(sessionMatch[1]))
  }

  return json({ error: { code: "not_found", message: "API route was not found" } }, { status: 404 })
}

const secureAssetResponse = (response: Response): Response => {
  const secured = new Response(response.body, response)
  secured.headers.set("x-content-type-options", "nosniff")
  secured.headers.set("x-frame-options", "DENY")
  secured.headers.set("referrer-policy", "no-referrer")
  secured.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()")
  secured.headers.set(
    "content-security-policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  )
  return secured
}

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/api/")) return await routeApi(request, env)
      return secureAssetResponse(await env.ASSETS.fetch(request))
    } catch (error) {
      if (error instanceof HttpFailure) return errorResponse(error)
      console.error("Unhandled request failure", error)
      return json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, { status: 500 })
    }
  }
} satisfies ExportedHandler<WorkerEnv>
