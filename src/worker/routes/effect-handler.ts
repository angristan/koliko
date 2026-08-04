import type { Context } from "hono"
import { Effect } from "effect"
import type { HttpFailure } from "../http"
import { traceOperation, type OperationName } from "../observability"
import type { WorkerHonoEnv } from "./types"

export const runEffect = (
  context: Context<WorkerHonoEnv>,
  effect: Effect.Effect<Response, HttpFailure>,
  operation?: OperationName
): Promise<Response> => {
  const run = () => Effect.runPromise(effect, { signal: context.req.raw.signal })
  if (operation === undefined) return run()

  // Hono's portable type omits Cloudflare's tracing extension from the runtime context.
  const executionContext = context.executionCtx as unknown as ExecutionContext
  return traceOperation(executionContext, operation, run)
}
