import { Hono } from "hono"
import { errorResponse, HttpFailure, json } from "./http"
import { analyticsRoutes } from "./routes/analytics"
import { authRoutes } from "./routes/auth"
import { keyRoutes } from "./routes/keys"
import { telemetryRoutes } from "./routes/telemetry"
import type { WorkerHonoEnv } from "./routes/types"

const apiRoutes = new Hono<WorkerHonoEnv>()
  .route("/auth", authRoutes)
  .route("/v1", telemetryRoutes)
  .route("/keys", keyRoutes)
  .route("/", analyticsRoutes)

export const app = new Hono<WorkerHonoEnv>()
  .route("/api", apiRoutes)
  .notFound((context) => context.req.path.startsWith("/api/")
    ? json({ error: { code: "not_found", message: "API route was not found" } }, { status: 404 })
    : new Response("Not found", { status: 404 }))
  .onError((error) => {
    if (error instanceof HttpFailure) return errorResponse(error)

    console.error("Unhandled request failure", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    })
    return json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, { status: 500 })
  })
