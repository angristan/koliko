import { HttpFailure } from "./http"

export const operationNames = {
  registerPasskey: "app.auth.passkey.register",
  authenticatePasskey: "app.auth.passkey.authenticate",
  ingestTelemetry: "app.telemetry.ingest",
  loadDashboard: "app.analytics.dashboard",
  createApiKey: "app.keys.create"
} as const

export type OperationName = typeof operationNames[keyof typeof operationNames]

export const traceOperation = <A>(
  context: ExecutionContext,
  name: OperationName,
  operation: () => Promise<A>
): Promise<A> => {
  if (!context.tracing) return operation()

  return context.tracing.enterSpan(name, async (span) => {
    try {
      return await operation()
    } catch (error) {
      span.setAttribute("app.failed", true)
      span.setAttribute(
        "app.failure.category",
        error instanceof HttpFailure
          ? error.status >= 500 ? "server" : "client"
          : "unexpected"
      )
      throw error
    }
  })
}
