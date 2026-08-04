import { Hono } from "hono"
import { operationNames } from "../observability"
import { ingestTelemetry } from "../telemetry"
import { runEffect } from "./effect-handler"
import type { WorkerHonoEnv } from "./types"

export const telemetryRoutes = new Hono<WorkerHonoEnv>()
  .post("/events", (context) =>
    runEffect(
      context,
      ingestTelemetry(context.req.raw, context.env),
      operationNames.ingestTelemetry
    ))
