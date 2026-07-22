# Architecture

Traker separates dashboard authentication from telemetry ingestion. Coding-agent collectors never receive a dashboard session, and browsers never need an ingestion key.

## Components

```text
+----------------------+       +-------------------------+
| Pi collector         |       | Browser                 |
|                      |       |                         |
| lifecycle hooks      |       | React + Kumo dashboard |
| 0600 JSONL spool     |       | WebAuthn passkey        |
+----------+-----------+       +------------+------------+
           |                                    |
           | POST /api/v1/events                | /api/auth/*
           | bearer ingestion key               | signed session cookie
           +----------------+-------------------+
                            |
                  +---------v----------+
                  | Cloudflare Worker  |
                  |                    |
                  | schema validation  |
                  | auth boundaries    |
                  | analytics SQL      |
                  | static assets      |
                  +---------+----------+
                            |
                         +--v--+
                         | D1  |
                         +-----+
```

### Pi collector

The Pi extension lives in `collectors/pi/`. It observes Pi lifecycle events and converts them to schema-versioned metadata events. Every event is appended to a local JSONL spool before delivery. The collector sends batches of up to 100 events and removes them from the spool only after a successful response.

The collector does not inspect session history or backfill old sessions.

### Worker

The Worker owns four responsibilities:

1. Serve the Vite production build through Workers Static Assets.
2. register and verify WebAuthn passkeys;
3. authenticate and persist telemetry batches;
4. query D1 for dashboard summaries and session details.

Effect Schema decodes request bodies and database query results at the application boundary.

### D1

D1 contains three tables:

| Table | Purpose |
| --- | --- |
| `passkeys` | WebAuthn public credentials, counters, transports, and usage timestamps |
| `api_keys` | Key names, visible prefixes, SHA-256 hashes, revocation state, and usage timestamps |
| `telemetry_events` | Schema-versioned event metadata used by analytics queries |

The raw ingestion key and the WebAuthn private key are never stored in D1.

## Request flows

### First dashboard setup

1. The browser requests registration options and supplies the bootstrap token.
2. The Worker creates a five-minute signed challenge cookie.
3. The browser creates a resident WebAuthn credential with required user verification.
4. The Worker verifies the response against `RP_ID` and `EXPECTED_ORIGIN`.
5. The public credential is stored in D1 and the browser receives a seven-day, `HttpOnly`, `SameSite=Strict` session cookie.

Once at least one passkey exists, new passkeys require an authenticated dashboard session. The bootstrap token is no longer accepted for registration.

### Dashboard login

1. The Worker returns a five-minute authentication challenge and the registered credential list.
2. The browser signs the challenge with a passkey.
3. The Worker verifies origin, relying-party ID, signature, counter, and user verification.
4. The credential counter and last-used timestamp are updated.
5. The Worker issues a new seven-day session cookie.

### Telemetry ingestion

1. The collector reads up to 100 valid events from its local spool.
2. It sends an `IngestBatch` to `POST /api/v1/events` with a bearer key.
3. The Worker hashes the presented key and resolves an active key record.
4. Effect Schema strips unknown fields and validates schema version 1.
5. D1 executes all event inserts and the API-key usage update in one native batch.
6. The Worker returns HTTP `202` with the accepted event count.
7. The collector atomically rewrites its spool without the delivered events.

## Idempotency

Each telemetry event has a globally unique event ID. `telemetry_events.event_id` is the primary key, and ingestion uses `INSERT OR IGNORE`.

This gives at-least-once delivery from the collector with idempotent storage at the service. A response lost after D1 commits may cause the collector to resend the batch, but duplicate rows are not created.

## Event model

Schema version 1 supports:

- `runtime_started`
- `runtime_ended`
- `agent_run`
- `usage`
- `model_selected`
- `thinking_selected`
- `compaction`
- `tool_execution`
- `goal`
- `subagent`

Common fields include session and runtime IDs, sequence, timestamp, repository folder, provider, model, thinking level, durations, token counters, cost, tool name, status, and scalar lifecycle attributes.

See [Privacy](privacy.md) for the content boundary and [Pi collector](pi-collector.md) for the Pi-to-event mapping.

## Failure behavior

| Failure | Behavior |
| --- | --- |
| Network unavailable | Events remain in the local spool for a later flush |
| HTTP authentication or server error | The current batch remains in the spool |
| Process exits | Shutdown attempts a bounded two-second flush; remaining events stay on disk |
| Malformed spool line | The line moves to `spool.jsonl.invalid`; valid lines continue |
| Batch delivered twice | Duplicate event IDs are ignored by D1 |
| Dashboard session expires | Analytics APIs return `401`; telemetry ingestion is unaffected |

The spool is the delivery buffer for the current design. Cloudflare Queues and Durable Objects are intentionally not required for personal telemetry volume.
