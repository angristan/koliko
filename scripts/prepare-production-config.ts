import { chmod, readFile, writeFile } from "node:fs/promises"

const configPath = "wrangler.production.jsonc"

const validateConfig = (contents: string): void => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error("Production Wrangler config must be valid JSON-compatible JSONC")
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Production Wrangler config must be an object")
  }
  if (contents.includes("replace-with-your-d1-database-id") || contents.includes("traker.example.com")) {
    throw new Error("Production Wrangler config still contains example values")
  }
}

const encoded = process.env.TRAKER_WRANGLER_CONFIG_B64
if (encoded) {
  const contents = Buffer.from(encoded, "base64").toString("utf8")
  validateConfig(contents)
  await writeFile(configPath, contents.endsWith("\n") ? contents : `${contents}\n`, {
    encoding: "utf8",
    mode: 0o600
  })
  await chmod(configPath, 0o600)
} else {
  let contents: string
  try {
    contents = await readFile(configPath, "utf8")
  } catch {
    throw new Error(
      "Missing wrangler.production.jsonc. Copy the example locally or set TRAKER_WRANGLER_CONFIG_B64 in Workers Builds."
    )
  }
  validateConfig(contents)
}
