import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient
} from "@tanstack/react-query"
import { Effect } from "effect"
import {
  createApiKey,
  getApiKeys,
  getAuthStatus,
  getDashboard,
  getPasskeys,
  getSession,
  loginWithPasskey,
  logout,
  registerPasskey,
  removePasskey,
  revokeApiKey,
  type RegisterPasskeyInput
} from "./api"

export const dashboardQueryKeys = {
  auth: ["auth"] as const,
  dashboard: (from: string, to: string) => ["dashboard", from, to] as const,
  dashboards: ["dashboard"] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  sessions: ["session"] as const,
  apiKeys: ["apiKeys"] as const,
  passkeys: ["passkeys"] as const
}

const runApiEffect = <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> =>
  Effect.runPromise(effect, signal === undefined ? undefined : { signal })

export const retryIdempotentGet = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 2 || typeof error !== "object" || error === null || !("_tag" in error)) return false
  if (error._tag === "ApiTransportError") return true
  return error._tag === "ApiStatusError" && "status" in error
    && typeof error.status === "number" && error.status >= 500
}

export const authQueryOptions = () => queryOptions({
  queryKey: dashboardQueryKeys.auth,
  queryFn: ({ signal }) => runApiEffect(getAuthStatus(), signal),
  staleTime: 60_000,
  retry: retryIdempotentGet
})

export const dashboardQueryOptions = (from: string, to: string) => queryOptions({
  queryKey: dashboardQueryKeys.dashboard(from, to),
  queryFn: ({ signal }) => runApiEffect(getDashboard(from, to), signal),
  placeholderData: keepPreviousData,
  staleTime: 30_000,
  retry: retryIdempotentGet
})

export const sessionQueryOptions = (sessionId: string) => queryOptions({
  queryKey: dashboardQueryKeys.session(sessionId),
  queryFn: ({ signal }) => runApiEffect(getSession(sessionId), signal),
  staleTime: 30_000,
  retry: retryIdempotentGet
})

export const apiKeysQueryOptions = () => queryOptions({
  queryKey: dashboardQueryKeys.apiKeys,
  queryFn: ({ signal }) => runApiEffect(getApiKeys(), signal),
  staleTime: 30_000,
  retry: retryIdempotentGet
})

export const passkeysQueryOptions = () => queryOptions({
  queryKey: dashboardQueryKeys.passkeys,
  queryFn: ({ signal }) => runApiEffect(getPasskeys(), signal),
  staleTime: 30_000,
  retry: retryIdempotentGet
})

export const useLoginMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => runApiEffect(loginWithPasskey()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.auth }),
    retry: false
  })
}

export const useRegisterPasskeyMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: RegisterPasskeyInput) => runApiEffect(registerPasskey(input)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.auth }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.passkeys })
      ])
    },
    retry: false
  })
}

export const useRemovePasskeyMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => runApiEffect(removePasskey(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.passkeys }),
    retry: false
  })
}

export const useLogoutMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => runApiEffect(logout()),
    onSuccess: async () => {
      queryClient.setQueryData(dashboardQueryKeys.auth, {
        authenticated: false,
        hasPasskey: true
      })
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.dashboards })
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.sessions })
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.apiKeys })
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.passkeys })
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.auth })
    },
    retry: false
  })
}

export const useCreateApiKeyMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => runApiEffect(createApiKey(name)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.apiKeys }),
    retry: false
  })
}

export const useRevokeApiKeyMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => runApiEffect(revokeApiKey(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.apiKeys }),
    retry: false
  })
}
