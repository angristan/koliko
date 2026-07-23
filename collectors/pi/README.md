# Koliko Pi collector

The [Koliko](https://github.com/angristan/koliko) collector for
[Pi](https://github.com/earendil-works/pi-coding-agent) records content-free
usage telemetry: session and agent runtime, model and thinking-level changes,
token usage, provider-reported cost, tool timing and status, compaction, goals,
and delegated work.

It never collects prompts, responses, reasoning, source code, file contents,
tool arguments or output, command text, file paths, or Git remotes. Repository
labels contain only the working tree's folder name.

## Install

```bash
pi install git:github.com/angristan/koliko
```

Reload the current Pi session with `/reload`, or start a new session.

## Configure

Create `~/.pi/agent/koliko/config.json` with the URL of your Koliko deployment
and an ingestion key created from its **Settings** page:

```json
{
  "baseUrl": "https://koliko.example.com",
  "apiKey": "klk_..."
}
```

Protect the file:

```bash
chmod 600 ~/.pi/agent/koliko/config.json
```

Alternatively, set `KOLIKO_URL` and `KOLIKO_API_KEY`. Environment variables
override the corresponding file values.

## Commands

| Command | Purpose |
| --- | --- |
| `/koliko-status` | Show whether collection is enabled and the configured service URL |
| `/koliko-flush` | Send queued events immediately |
| `/koliko-config <url>` | Save the service URL without changing the ingestion key |

Events are durably queued in `~/.pi/agent/koliko/spool.jsonl` before delivery,
so network failures do not discard pending telemetry.

See the [complete Pi collector documentation](../../docs/pi-collector.md) for
local-checkout installation, configuration precedence, event mapping, queue
behavior, updates, and troubleshooting. See [Privacy](../../docs/privacy.md) for
the complete data contract.
