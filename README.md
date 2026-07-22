# Traker

Privacy-first, WakaTime-style analytics for coding agents.

Traker records metadata about sessions, models, thinking levels, token usage, provider-reported cost, cache behavior, tools, context compaction, goals, and sub-agents. It does **not** collect conversation or code content. Pi is the first collector, with room for additional coding-agent integrations.

## Architecture

```text
Traker Pi collector
  ├─ observes Pi lifecycle events
  ├─ appends metadata to a local 0600 spool
  └─ batches up to 100 idempotent events
              │ Bearer ingest key
              ▼
Cloudflare Worker ───── Static Assets (React + Kumo dashboard)
  ├─ WebAuthn passkey authentication
  ├─ SHA-256 hashed ingest API keys
  ├─ Effect Schema boundary validation
  └─ D1 event storage and SQL analytics
```

The first version uses Workers, Static Assets, and D1. A Queue or Durable Object is unnecessary at personal telemetry volume: the extension's durable local spool already provides retry behavior, and D1 primary-key inserts make retries idempotent.

## What is tracked

- Distinct sessions and active agent runtime
- Repository **folder name only**
- Provider, model, and thinking level
- Input, output, cache-read, cache-write, and total tokens
- Provider-reported cost
- Tool names, durations, and error status
- Compaction reason and context tokens before compaction
- Goal lifecycle action counts
- Sub-agent lifecycle action and count
- Model and thinking-level changes

## Privacy contract

Traker collectors never send:

- Prompts or responses
- Thinking/reasoning content
- Source code
- Tool arguments, command text, or tool output
- File names or absolute paths
- Git remotes
- Goal objectives or sub-agent task text

The wire schema strips unknown fields before persistence. Repository identity is derived from the Git root folder name, falling back to the current working-directory folder name.

## Local development

Requirements: Bun, a recent Pi installation, and a WebAuthn-capable browser.

```bash
bun install
cp .dev.vars.example .dev.vars
# Fill BOOTSTRAP_TOKEN and SESSION_SECRET with independent random values.
bun run build
bun run db:migrate:local
bun run dev:worker
```

Open `http://localhost:8787`, enter `BOOTSTRAP_TOKEN`, and register a passkey.

For dashboard HMR, run these in separate terminals:

```bash
bun run dev:worker
bun run dev:web
```

Vite proxies `/api` to the Worker on port 8787. WebAuthn should be exercised on the Worker origin because RP IDs and origins must match.

## Cloudflare deployment

These commands create or mutate resources in your Cloudflare account; run them only after reviewing the target account shown by Wrangler.

1. Authenticate and create D1:

   ```bash
   bunx wrangler whoami
   bunx wrangler d1 create traker
   ```

2. Put the returned database ID in `wrangler.jsonc`.

3. Set the production WebAuthn values in `wrangler.jsonc` before registering a passkey:

   ```jsonc
   "vars": {
     "RP_NAME": "Traker",
     "RP_ID": "traker.example.com",
     "EXPECTED_ORIGIN": "https://traker.example.com"
   }
   ```

   `RP_ID` is the hostname only. `EXPECTED_ORIGIN` includes the scheme and has no trailing slash. For a `workers.dev` deployment, use its exact hostname and origin.

4. Create independent random values and store them as Worker secrets:

   ```bash
   openssl rand -base64 32 | bunx wrangler secret put BOOTSTRAP_TOKEN
   openssl rand -base64 32 | bunx wrangler secret put SESSION_SECRET
   ```

5. Apply the schema and deploy:

   ```bash
   bun run db:migrate:remote
   bun run deploy
   ```

6. Open the deployed URL, enter the bootstrap token once, and register the first passkey.

Changing the RP ID or origin invalidates existing passkeys. Configure the final domain before first registration.

## Create an ingest API key

After passkey login:

1. Open **Settings**.
2. Create an API key for the Pi installation.
3. Copy it immediately; only its SHA-256 hash is stored by the service.

Keys can be revoked independently from the dashboard.

## Install the Pi collector

Install the public package from GitHub:

```bash
pi install git:github.com/angristan/traker
```

For a local checkout instead:

```bash
pi install /absolute/path/to/traker
```

Or test it without installing:

```bash
pi -e /absolute/path/to/traker/extension/index.ts
```

Configure with environment variables:

```bash
export TRAKER_URL="https://traker.stanislas.cloud"
export TRAKER_API_KEY="trk_..."
```

Alternatively, create `~/.pi/agent/traker/config.json`:

```json
{
  "baseUrl": "https://traker.stanislas.cloud",
  "apiKey": "trk_..."
}
```

Then protect it:

```bash
chmod 600 ~/.pi/agent/traker/config.json
```

The API key environment variable overrides the file. `/traker-config <url>` can safely save only the service URL; `/traker-status` shows whether tracking is enabled, and `/traker-flush` retries the local spool immediately.

The spool lives at `~/.pi/agent/traker/spool.jsonl`, uses mode `0600`, and is retained across network failures or Pi restarts.

## Dashboard metrics

- **Tracked agent time**: time from `agent_start` until `agent_settled`, excluding idle time between prompts.
- **Cache read rate**: `cacheRead / (input + cacheRead)`.
- **Cost**: Pi's model-pricing result, including assistant, nested tool-model, and compaction usage when Pi exposes it.
- **Tool success**: successful tool executions divided by all completed tool executions.
- **Sessions**: distinct Pi session IDs in the selected date range.

## Commands

```bash
bun run typecheck
bun run test
bun run build
bun run cf:typegen
bun run db:migrate:local
```

No historical backfill is performed. Tracking begins when the configured extension starts a Pi session.

## License

MIT
