import { Effect } from "effect"
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
import { operationNames, traceOperation, type OperationName } from "./observability"
import { ingestTelemetry } from "./telemetry"

const runRequest = (
  request: Request,
  effect: Effect.Effect<Response, HttpFailure>
): Promise<Response> => Effect.runPromise(effect, { signal: request.signal })

const runTracedRequest = (
  request: Request,
  context: ExecutionContext,
  name: OperationName,
  effect: Effect.Effect<Response, HttpFailure>
): Promise<Response> => traceOperation(context, name, () => runRequest(request, effect))

const routeApi = (
  request: Request,
  env: WorkerEnv,
  context: ExecutionContext
): Promise<Response> => {
  const url = new URL(request.url)
  const { pathname } = url

  if (request.method === "GET" && pathname === "/api/auth/status") return runRequest(request, authStatus(request, env))
  if (request.method === "POST" && pathname === "/api/auth/register/options") return runRequest(request, registrationOptions(request, env))
  if (request.method === "POST" && pathname === "/api/auth/register/verify") {
    return runTracedRequest(request, context, operationNames.registerPasskey, verifyRegistration(request, env))
  }
  if (request.method === "POST" && pathname === "/api/auth/login/options") return runRequest(request, authenticationOptions(request, env))
  if (request.method === "POST" && pathname === "/api/auth/login/verify") {
    return runTracedRequest(request, context, operationNames.authenticatePasskey, verifyAuthentication(request, env))
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") return runRequest(request, logout(request, env))

  if (request.method === "POST" && pathname === "/api/v1/events") {
    return runTracedRequest(request, context, operationNames.ingestTelemetry, ingestTelemetry(request, env))
  }
  if (request.method === "GET" && pathname === "/api/dashboard") {
    return runTracedRequest(request, context, operationNames.loadDashboard, dashboard(request, env))
  }
  if (request.method === "GET" && pathname === "/api/keys") return runRequest(request, listApiKeys(request, env))
  if (request.method === "POST" && pathname === "/api/keys") {
    return runTracedRequest(request, context, operationNames.createApiKey, createApiKey(request, env))
  }

  const keyMatch = pathname.match(/^\/api\/keys\/([^/]+)$/u)
  if (request.method === "DELETE" && keyMatch) {
    return runRequest(request, revokeApiKey(request, env, decodeURIComponent(keyMatch[1])))
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/u)
  if (request.method === "GET" && sessionMatch) {
    return runRequest(request, sessionDetail(request, env, decodeURIComponent(sessionMatch[1])))
  }

  return Promise.resolve(json({ error: { code: "not_found", message: "API route was not found" } }, { status: 404 }))
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
      return await routeApi(request, env, ctx)
    } catch (error) {
      if (error instanceof HttpFailure) return errorResponse(error)
      console.error("Unhandled request failure", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      })
      return json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, { status: 500 })
    }
  }
} satisfies ExportedHandler<WorkerEnv>
