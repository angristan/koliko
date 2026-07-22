import { Schema } from "effect"

export interface WorkerEnv extends Env {
  readonly BOOTSTRAP_TOKEN: string
  readonly SESSION_SECRET: string
}

export class HttpFailure extends Schema.TaggedErrorClass<HttpFailure>()("HttpFailure", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String
}) {}

export const json = (body: unknown, init?: ResponseInit): Response => {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return new Response(JSON.stringify(body), { ...init, headers })
}

export const noContent = (): Response => new Response(null, { status: 204 })

export const errorResponse = (error: HttpFailure): Response =>
  json({ error: { code: error.code, message: error.message } }, { status: error.status })

export const getCookie = (request: Request, name: string): string | undefined => {
  const cookie = request.headers.get("cookie")
  if (!cookie) return undefined

  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return undefined
}

export const makeCookie = (
  name: string,
  value: string,
  origin: string,
  maxAgeSeconds: number
): string => {
  const secure = origin.startsWith("https://") ? "; Secure" : ""
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`
}

export const clearCookie = (name: string, origin: string): string =>
  makeCookie(name, "", origin, 0)

export const assertSameOrigin = (request: Request, env: WorkerEnv): void => {
  const origin = request.headers.get("origin")
  if (origin !== env.EXPECTED_ORIGIN) {
    throw HttpFailure.make({ status: 403, code: "invalid_origin", message: "Request origin is not allowed" })
  }
}

export const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    throw HttpFailure.make({ status: 400, code: "invalid_json", message: "Request body must be valid JSON" })
  }
}
