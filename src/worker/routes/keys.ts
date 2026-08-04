import { Hono } from "hono"
import { createApiKey, listApiKeys, revokeApiKey } from "../auth"
import { operationNames } from "../observability"
import { runEffect } from "./effect-handler"
import type { WorkerHonoEnv } from "./types"

export const keyRoutes = new Hono<WorkerHonoEnv>()
  .get("/", (context) =>
    runEffect(context, listApiKeys(context.req.raw, context.env)))
  .post("/", (context) =>
    runEffect(
      context,
      createApiKey(context.req.raw, context.env),
      operationNames.createApiKey
    ))
  .delete("/:id", (context) =>
    runEffect(
      context,
      revokeApiKey(context.req.raw, context.env, context.req.param("id"))
    ))
