# Pi collector

The Pi extension translates Pi lifecycle events into Traker's content-free telemetry schema.

## Install

From GitHub:

```bash
pi install git:github.com/angristan/traker
```

From a local checkout:

```bash
pi install /absolute/path/to/traker
```

To load a checkout without installing it:

```bash
pi -e /absolute/path/to/traker/extension/index.ts
```

After installation, run `/reload` in an existing Pi session or start a new session.

Update the package with:

```bash
pi update git:github.com/angristan/traker
```

## Create an ingestion key

Sign in to the Traker dashboard, open **Settings**, and create one key for this collector. Copy the full `trk_...` value immediately. The service stores only its hash and cannot display it again.

Use a separate key for each machine or collector so it can be revoked independently.

## Configure

### Private config file

Create `~/.pi/agent/traker/config.json`:

```json
{
  "baseUrl": "https://traker.example.com",
  "apiKey": "trk_..."
}
```

Then set restrictive permissions:

```bash
chmod 600 ~/.pi/agent/traker/config.json
```

Set `"enabled": false` to disable the collector from the file, including when environment variables are present.

### Environment variables

```bash
export TRAKER_URL="https://traker.example.com"
export TRAKER_API_KEY="trk_..."
```

Resolution order is per value:

| Setting | First | Fallback |
| --- | --- | --- |
| Service URL | `TRAKER_URL` | `config.json` `baseUrl` |
| Ingestion key | `TRAKER_API_KEY` | `config.json` `apiKey` |

A configuration is active only when both values resolve. URLs must use HTTPS except for `localhost` and `127.0.0.1`.

When `PI_CODING_AGENT_DIR` is set, the `traker` directory is created beneath that path instead of `~/.pi/agent`.

## Commands

| Command | Purpose |
| --- | --- |
| `/traker-status` | Show whether collection is enabled and the configured service URL |
| `/traker-flush` | Attempt to send queued events immediately |
| `/traker-config <url>` | Save the service URL without changing the private API key |

`/traker-config` intentionally does not accept or echo an ingestion key.

## Event mapping

| Pi event | Traker event | Metadata |
| --- | --- | --- |
| `session_start` | `runtime_started` | Repository folder, provider, model, thinking level, reason, mode |
| `agent_start` + `agent_settled` | `agent_run` | Active duration, provider, model, thinking level |
| Assistant `message_end` | `usage` | Token counters, cost, provider, model, source |
| Tool-result `message_end` with usage | `usage` | Token counters, cost, source |
| `model_select` | `model_selected` | Provider, model, thinking level, selection source |
| `thinking_level_select` | `thinking_selected` | Provider, model, selected level |
| `session_compact` | `compaction` and optional `usage` | Reason, retry flag, tokens before, compaction usage |
| Branch summary in `session_tree` | `usage` | Branch-summary usage when exposed by Pi |
| `tool_execution_start` + `tool_execution_end` | `tool_execution` | Tool name, duration, success/error |
| Completed `goal_*` tool | `goal` | Lifecycle action and status |
| Completed `agents` or `subagent` tool | `subagent` | Lifecycle shape, count, duration, status |
| `session_shutdown` | `runtime_ended` | Runtime duration and shutdown reason |

See [Privacy](privacy.md) for fields deliberately omitted from these mappings.

## Queue and retry behavior

Pending events are stored at:

```text
~/.pi/agent/traker/spool.jsonl
```

The queue:

- appends an event before attempting delivery;
- serializes local queue reads and writes;
- flushes when a session starts;
- flushes after an agent run settles;
- attempts a flush every 15 seconds;
- triggers another flush every 25 queued events;
- sends at most 100 events per request;
- attempts a bounded two-second flush during shutdown;
- atomically rewrites the spool only after HTTP success.

Network errors and non-success HTTP responses leave the current batch in place. Event IDs make server-side retries idempotent.

Malformed JSONL lines are copied to `spool.jsonl.invalid` and removed from the active spool. Inspect that file before deleting it.

## Troubleshooting

### `/traker-status` reports disabled

Confirm that both the URL and key resolve and that `enabled` is not `false`:

```bash
stat -f '%Lp %N' ~/.pi/agent/traker/config.json
```

Expected mode: `600`.

### Ingestion returns `401`

The key is missing, malformed, unknown, or revoked. Create a replacement in dashboard **Settings**, update the collector config, and run `/traker-flush`.

### Events stay in the spool

1. Run `/traker-flush` and note the HTTP status.
2. Confirm the configured URL is reachable over HTTPS.
3. Confirm the key is active in dashboard **Settings**.
4. Check the Worker logs if you operate the deployment.

Do not paste the spool or config file into an issue without reviewing it. The files exclude prompts and code, but they still contain repository folder names, usage metadata, and possibly an active ingestion key.

### The dashboard shows no historical sessions

This is expected. The collector begins at the first configured `session_start` and does not scan existing Pi session files.
