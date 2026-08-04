import { Hono } from "hono"
import {
  authenticationOptions,
  authStatus,
  deletePasskey,
  listPasskeys,
  logout,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration
} from "../auth"
import { operationNames } from "../observability"
import { runEffect } from "./effect-handler"
import type { WorkerHonoEnv } from "./types"

export const authRoutes = new Hono<WorkerHonoEnv>()
  .get("/status", (context) =>
    runEffect(context, authStatus(context.req.raw, context.env)))
  .post("/register/options", (context) =>
    runEffect(context, registrationOptions(context.req.raw, context.env)))
  .post("/register/verify", (context) =>
    runEffect(
      context,
      verifyRegistration(context.req.raw, context.env),
      operationNames.registerPasskey
    ))
  .post("/login/options", (context) =>
    runEffect(context, authenticationOptions(context.req.raw, context.env)))
  .post("/login/verify", (context) =>
    runEffect(
      context,
      verifyAuthentication(context.req.raw, context.env),
      operationNames.authenticatePasskey
    ))
  .post("/logout", (context) =>
    runEffect(context, logout(context.req.raw, context.env)))
  .get("/passkeys", (context) =>
    runEffect(context, listPasskeys(context.req.raw, context.env)))
  .delete("/passkeys/:id", (context) =>
    runEffect(
      context,
      deletePasskey(context.req.raw, context.env, context.req.param("id"))
    ))
