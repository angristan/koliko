# Self-hosting and operations

Traker runs as one Cloudflare Worker with Static Assets and one D1 database.

## Prerequisites

- Bun
- A Cloudflare account with Workers and D1 access
- Wrangler authentication
- A WebAuthn-capable browser
- A final hostname for the dashboard

Choose the hostname before registering a passkey. WebAuthn credentials are bound to the relying-party ID and origin.

## 1. Clone and install

```bash
git clone git@github.com:angristan/traker.git
cd traker
bun install
bunx wrangler whoami
```

Review the account shown by Wrangler before creating resources.

## 2. Create D1

```bash
bunx wrangler d1 create traker
```

Copy the returned database ID into the `DB` binding in `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "traker",
    "database_id": "your-database-id",
    "migrations_dir": "migrations"
  }
]
```

The checked-in ID belongs to the maintainer's deployment. Forks must replace it.

You can add `--location weur`, `--location enam`, or another supported location hint when creating the database.

## 3. Configure the final origin

For a custom domain:

```jsonc
"workers_dev": false,
"preview_urls": false,
"routes": [
  {
    "pattern": "traker.example.com",
    "custom_domain": true
  }
],
"vars": {
  "RP_NAME": "Traker",
  "RP_ID": "traker.example.com",
  "EXPECTED_ORIGIN": "https://traker.example.com"
}
```

Rules:

- `RP_ID` is a hostname without a scheme or path.
- `EXPECTED_ORIGIN` includes `https://` and has no trailing slash.
- The custom domain must belong to a zone in the active Cloudflare account.
- A conflicting DNS record must be removed or changed before deployment.

For `workers.dev`, enable it and use the exact deployed hostname for both WebAuthn values.

Changing either value after passkey registration makes existing credentials unusable on the new origin.

## 4. Create secrets

Generate independent random values:

```bash
openssl rand -base64 32 | bunx wrangler secret put BOOTSTRAP_TOKEN
openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET
```

- `BOOTSTRAP_TOKEN` authorizes registration only while the database contains no passkey.
- `SESSION_SECRET` signs five-minute challenges and seven-day dashboard sessions.

Do not put either value in `wrangler.jsonc`, Git, shell history, or issue reports.

## 5. Migrate and deploy

```bash
bun run build
bunx wrangler deploy --dry-run
bun run db:migrate:remote
bun run deploy
```

The deployment uploads the Worker and Vite assets and applies the configured custom-domain trigger.

## 6. Register the first passkey

Open the final origin in a WebAuthn-capable browser.

1. Enter the bootstrap token.
2. Create a passkey with user verification.
3. Open **Settings** and add another passkey if you need a recovery authenticator.
4. Create one ingestion key per collector.

Once a passkey exists, adding another passkey requires a valid dashboard session instead of the bootstrap token.

Store the bootstrap token securely for disaster recovery. It becomes useful again only if all passkey rows are deliberately removed.

## Production checks

### Service and TLS

```bash
curl -fsS https://traker.example.com/api/auth/status
curl -fsSI https://traker.example.com/
```

A healthy unauthenticated status response looks like:

```json
{"authenticated":false,"hasPasskey":true}
```

Confirm the HTML response includes:

- `Content-Security-Policy`
- `Permissions-Policy`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

### Migrations

```bash
bunx wrangler d1 migrations list traker --remote
```

### Logs

```bash
bunx wrangler tail traker
```

The Worker logs unexpected failures. Traker does not intentionally log request bodies or ingestion keys.

### Database inspection

Use narrow queries and avoid exporting telemetry unless necessary:

```bash
bunx wrangler d1 execute traker --remote \
  --command "SELECT event_type, COUNT(*) AS count FROM telemetry_events GROUP BY event_type"
```

## Upgrades

```bash
git pull --ff-only
bun install
bun run typecheck
bun run test
bun run build
bunx wrangler d1 migrations list traker --remote
bun run db:migrate:remote
bun run deploy
```

Apply migrations before relying on code that expects the new schema. Never edit an already-applied migration; add a new numbered migration.

Regenerate Worker types after changing bindings or environment variables:

```bash
bun run cf:typegen
```

## Credential operations

### Ingestion key rotation

1. Create a new key in dashboard **Settings**.
2. Update the collector's private config.
3. Start or reload Pi and run `/traker-flush`.
4. Confirm the new key has a recent last-used timestamp.
5. Revoke the old key.

### Session-secret rotation

```bash
openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET
```

This immediately invalidates dashboard sessions and pending WebAuthn challenges. It does not delete passkeys or ingestion keys.

### Bootstrap-token rotation

```bash
openssl rand -base64 32 | bunx wrangler secret put BOOTSTRAP_TOKEN
```

This does not affect existing passkeys or sessions. The token is ignored for passkey registration while at least one passkey exists.

## Backup, retention, and deletion

Traker does not implement automatic telemetry retention. Define an operator policy appropriate for your deployment.

Export D1 only when required because exports contain repository labels and usage metadata:

```bash
bunx wrangler d1 export traker --remote --output=traker-backup.sql
chmod 600 traker-backup.sql
```

Cloudflare Time Travel availability and retention depend on the Workers plan. Review current D1 documentation before treating it as a backup strategy.

For targeted deletion, first run an equivalent `SELECT`, verify the date range and row count, and back up if required. Deletion is intentionally not exposed in the dashboard.

## Common deployment failures

### Passkey origin mismatch

Symptoms include failed registration or authentication after moving domains. Verify `RP_ID`, `EXPECTED_ORIGIN`, browser URL, and protocol. Existing passkeys cannot be transferred between relying-party IDs.

### Custom domain does not resolve

Confirm the zone is active, there is no conflicting DNS record, and the Worker deployment lists the custom-domain trigger.

### Analytics queries fail after an upgrade

Check remote migration state and Worker logs. The deployed code and D1 schema must come from the same release.

### Collector receives `401`

The dashboard passkey is unrelated to ingestion. Confirm the collector uses an active `trk_...` key created in **Settings**.
