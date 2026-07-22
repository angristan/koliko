# Privacy

Traker is designed to answer usage questions without collecting the work performed by the coding agent.

This document describes the schema enforced by the Pi collector and the Worker. It is a technical data contract, not a general privacy policy for a hosted service.

## Collected data

### Identity and timing

- Random event, session, and runtime identifiers
- Per-runtime sequence number
- Event occurrence and receipt timestamps
- Active agent duration
- Repository folder name

Repository identity is the basename of the Git root. When no Git root is available, the current working-directory basename is used.

### Model usage

- Provider name
- Model identifier
- Thinking-level label
- Input, output, cache-read, cache-write, and total token counts
- Provider-reported total cost

Traker stores the thinking-level setting, such as `high`; it does not store thinking or reasoning content.

### Agent features

- Tool name, duration, and success/error status
- Compaction reason, retry flag, and token count before compaction
- Goal lifecycle action name and status
- Sub-agent lifecycle action, count, duration, and status
- Model-selection source

Lifecycle attributes are scalar metadata defined by the collector. Arbitrary nested objects are not accepted by the event schema.

## Excluded data

The Pi collector does not send:

- user prompts;
- assistant responses;
- reasoning or thinking content;
- source code or file contents;
- file names;
- absolute or relative paths;
- tool arguments;
- tool output;
- command text;
- Git remotes;
- goal objectives;
- sub-agent task text.

The collector may temporarily receive some of this information from Pi lifecycle callbacks, but it does not place it in telemetry events. For example, tool arguments are held only long enough to derive a sub-agent lifecycle action and count; the arguments themselves are not serialized.

## Enforcement points

1. **Collector construction** — the Pi extension explicitly creates a `TelemetryEvent` from allowed metadata.
2. **Shared schema** — Effect Schema accepts only schema-versioned fields and scalar attributes. Unknown object fields are removed.
3. **Worker persistence** — the Worker maps decoded fields into explicit D1 columns instead of storing the incoming request wholesale.
4. **Session API** — dashboard session details are reconstructed from the same persisted metadata columns.

A new collector must preserve these boundaries. It must not reuse a provider transcript or raw agent event as an ingestion payload.

## Local data

The Pi collector stores:

| Path | Contents | Mode |
| --- | --- | --- |
| `~/.pi/agent/traker/config.json` | Service URL and ingestion key | `0600` |
| `~/.pi/agent/traker/spool.jsonl` | Pending telemetry events | `0600` |
| `~/.pi/agent/traker/spool.jsonl.invalid` | Rejected local spool lines, when present | `0600` |

The containing directory is created with mode `0700`. `PI_CODING_AGENT_DIR` changes the base agent directory.

The spool is plaintext metadata. Users who consider repository folder names or model usage sensitive should protect their account and filesystem accordingly.

## Server-side data

D1 stores telemetry until an operator removes it. Traker currently has no automatic retention window or dashboard deletion workflow.

Operators are responsible for:

- choosing an appropriate Cloudflare account and D1 location;
- controlling access to the Cloudflare account;
- defining retention and deletion procedures;
- backing up or exporting D1 only when required;
- revoking ingestion keys that are lost or no longer used.

## Secrets and credentials

- Passkey private keys stay in the user's authenticator.
- D1 stores WebAuthn public keys and signature counters.
- Ingestion keys are shown once; D1 stores only their SHA-256 hashes and prefixes.
- Dashboard sessions are signed with `SESSION_SECRET` and stored in `HttpOnly`, `SameSite=Strict` cookies.
- The bootstrap token is used only while no passkey exists.

Do not place bootstrap tokens, session secrets, ingestion keys, or `.dev.vars` in Git.

## Network boundary

Collector URLs must use HTTPS unless the hostname is `localhost` or `127.0.0.1`. Production deployments should keep the Worker security headers enabled and configure WebAuthn against the final hostname before registering credentials.

## Verifying the boundary

A practical collector test should:

1. trigger a tool event with recognizable fake arguments;
2. flush the collector;
3. query the corresponding `telemetry_events` rows;
4. confirm that `attributes_json` contains only the documented lifecycle fields;
5. confirm that the fake argument, path, command, and output are absent.

The automated protocol tests cover schema decoding. End-to-end privacy checks remain valuable whenever collector event mappings change.
