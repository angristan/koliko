const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const toBase64Url = (bytes: Uint8Array<ArrayBufferLike>): string => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

export const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export const randomToken = (bytes = 32): string => {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return toBase64Url(value)
}

export const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return toBase64Url(new Uint8Array(digest))
}

const hmac = async (secret: string, value: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  return toBase64Url(new Uint8Array(signature))
}

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

export const safeSecretEqual = async (left: string, right: string): Promise<boolean> => {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)])
  return constantTimeEqual(leftHash, rightHash)
}

export const signValue = async (secret: string, value: unknown): Promise<string> => {
  const payload = toBase64Url(encoder.encode(JSON.stringify(value)))
  return `${payload}.${await hmac(secret, payload)}`
}

export const verifySignedValue = async (secret: string, token: string): Promise<unknown | undefined> => {
  const separator = token.lastIndexOf(".")
  if (separator < 1) return undefined

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = await hmac(secret, payload)
  if (!constantTimeEqual(signature, expected)) return undefined

  try {
    return JSON.parse(decoder.decode(fromBase64Url(payload)))
  } catch {
    return undefined
  }
}
