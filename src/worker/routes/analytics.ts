import { Hono } from "hono"
import { dashboard, sessionDetail } from "../analytics"
import { operationNames } from "../observability"
import { runEffect } from "./effect-handler"
import type { WorkerHonoEnv } from "./types"

export const analyticsRoutes = new Hono<WorkerHonoEnv>()
  .get("/dashboard", (context) =>
    runEffect(
      context,
      dashboard(context.req.raw, context.env),
      operationNames.loadDashboard
    ))
  .get("/sessions/:id", (context) =>
    runEffect(
      context,
      sessionDetail(context.req.raw, context.env, context.req.param("id"))
    ))
