# Traker

Self-hostable usage analytics for coding agents.

Traker shows where agent time and tokens go without collecting the work itself. It tracks sessions, models, token usage, provider-reported cost, tools, context compaction, goals, and delegated work. Pi is the first supported collector; the ingestion protocol is agent-agnostic.

## What Traker provides

- Session, runtime, token, cost, and cache metrics
- Breakdowns by model, thinking level, and repository folder name
- Tool duration and error-rate reporting
- Compaction, goal, and sub-agent lifecycle counts
- Passkey-only dashboard access
- Independently revocable ingestion keys
- A durable local collector spool for offline and failed requests
- A Cloudflare deployment using Workers, Static Assets, and D1

## Data boundary

| Collected | Never collected |
| --- | --- |
| Session and runtime identifiers | Prompts or responses |
| Repository folder name | Source code or file contents |
| Provider, model, and thinking level | Reasoning content |
| Token counts and provider-reported cost | Tool arguments, output, or command text |
| Tool name, duration, and error status | File names or absolute paths |
| Compaction and lifecycle counters | Git remotes |

Unknown event fields are removed at the schema boundary. See [Privacy](docs/privacy.md) for the complete contract and its operational limits.

## Architecture

```text
Pi lifecycle events
        |
        v
0600 local JSONL spool
        |
        | HTTPS + bearer ingestion key
        v
Cloudflare Worker ---- React + Kumo dashboard
        |
        v
       D1
```

The collector batches at most 100 events. Event IDs are primary keys and ingestion uses `INSERT OR IGNORE`, so retrying a delivered batch is safe.

See [Architecture](docs/architecture.md) for request flows, authentication boundaries, and the data model.

## Start collecting with Pi

You need a Traker deployment and an ingestion key created from its **Settings** page.

### 1. Install the collector

```bash
pi install git:github.com/angristan/traker
```

Reload the current Pi session with `/reload`, or start a new session.

### 2. Configure it

Create `~/.pi/agent/traker/config.json`:

```json
{
  "baseUrl": "https://traker.example.com",
  "apiKey": "trk_..."
}
```

Protect the file:

```bash
chmod 600 ~/.pi/agent/traker/config.json
```

Environment variables override the corresponding file values:

```bash
export TRAKER_URL="https://traker.example.com"
export TRAKER_API_KEY="trk_..."
```

### 3. Verify it

Inside Pi:

```text
/traker-status
/traker-flush
```

Tracking starts with the next Pi session. Traker does not backfill existing sessions.

See [Pi collector](docs/pi-collector.md) for configuration precedence, event mapping, queue behavior, updates, and troubleshooting.

## Dashboard metrics

- **Agent time**: time between `agent_start` and `agent_settled`; idle time between prompts is excluded.
- **Cache read rate**: cache-read tokens divided by input plus cache-read tokens.
- **Cost**: the provider-reported total exposed by Pi for assistant, nested tool-model, compaction, and branch-summary usage when available.
- **Tool success**: completed tool calls without an error divided by all completed tool calls.
- **Sessions**: distinct Pi session IDs active in the selected date range.

## Self-hosting

Requirements:

- A Cloudflare account with Workers and D1 access
- A domain or `workers.dev` hostname fixed before passkey registration
- Bun
- A WebAuthn-capable browser

The short path is:

```bash
bun install
cp wrangler.production.jsonc.example wrangler.production.jsonc
bun run build
bunx wrangler d1 create traker
# Update the private production config with the D1 ID and final origin.
bunx wrangler secret put BOOTSTRAP_TOKEN --config wrangler.production.jsonc
bunx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
bun run deploy
```

Follow [Self-hosting](docs/self-hosting.md) before running these commands. It covers the exact configuration, first passkey, secret rotation, migrations, and production checks.

## Local development

```bash
bun install
cp .dev.vars.example .dev.vars
# Set independent BOOTSTRAP_TOKEN and SESSION_SECRET values.
bun run db:migrate:local
bun run dev
```

Open the URL printed by Vite and register a local passkey. The Cloudflare Vite plugin runs the Worker, bindings, dashboard, and HMR together in Workerd. Exercise WebAuthn on that single origin because the relying-party ID and browser origin must match.

## Validation

```bash
bun run verify
```

This checks generated Worker types, TypeScript, unit and Workerd integration tests, the Vite production build, and a Wrangler dry run. Workerd tests apply every D1 migration to isolated local storage.

## Documentation

- [Architecture](docs/architecture.md)
- [Privacy](docs/privacy.md)
- [Pi collector](docs/pi-collector.md)
- [Self-hosting and operations](docs/self-hosting.md)

## License

[MIT](LICENSE)
