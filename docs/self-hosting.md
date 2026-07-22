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
cp wrangler.production.jsonc.example wrangler.production.jsonc
bunx wrangler whoami
```

Review the account shown by Wrangler before creating resources.

## 2. Create D1

```bash
bunx wrangler d1 create traker
```

Copy the returned database ID into the `DB` binding in the ignored `wrangler.production.jsonc` file:

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

The tracked `wrangler.jsonc` remains configured for localhost. Real database IDs and deployment origins stay in the ignored production file.

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

### Placement and observability

Keep `placement.mode` set to `off`. Traker serves static assets through the same Worker with `run_worker_first`, so Smart Placement would route browser assets away from users. A future split frontend/backend architecture can evaluate Smart Placement for the D1-backed API Worker independently.

The production template explicitly persists Workers Logs and Traces at full sampling. Automatic platform spans cover requests and D1 calls; Traker adds one bounded custom span around passkey verification, telemetry ingestion, dashboard loading, and ingestion-key creation. Span attributes contain only a failure boolean and bounded failure category, and unexpected logs include only the error class.

Observability event volume scales approximately with requests plus captured spans and logs. Review Cloudflare usage before a high-traffic deployment. To stop trace ingestion quickly, set `observability.traces.enabled` to `false` and redeploy; choose a lower sampling rate only from measured traffic and retention requirements.

## 4. Create secrets

Generate independent random values:

```bash
openssl rand -base64 32 | bunx wrangler secret put BOOTSTRAP_TOKEN --config wrangler.production.jsonc
openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
```

- `BOOTSTRAP_TOKEN` authorizes registration only while the database contains no passkey.
- `SESSION_SECRET` signs five-minute challenges and seven-day dashboard sessions.

Do not put either value in `wrangler.jsonc`, Git, shell history, or issue reports.

## 5. Migrate and deploy

```bash
bun run deploy:dry-run
bun run deploy
```

The deployment validates types and tests, builds the dashboard, applies pending migrations, uploads the Worker and assets, and runs production smoke checks.

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
bunx wrangler d1 migrations list traker --remote --config wrangler.production.jsonc
```

### Logs

```bash
bunx wrangler tail traker --config wrangler.production.jsonc
```

The Worker logs unexpected failures using bounded error classes. It does not intentionally log request bodies, ingestion keys, repository labels, session IDs, or raw errors. Workers Traces adds privacy-safe business spans for the main authenticated and ingestion operations.

### Database inspection

Use narrow queries and avoid exporting telemetry unless necessary:

```bash
bunx wrangler d1 execute traker --remote --config wrangler.production.jsonc \
  --command "SELECT event_type, COUNT(*) AS count FROM telemetry_events GROUP BY event_type"
```

## Automatic deployment without publishing instance details

Keep `wrangler.production.jsonc` ignored. Workers Builds can reconstruct it from a secret build variable:

1. Base64-encode the complete production config without printing it to logs.
2. Create a secret build variable named `TRAKER_WRANGLER_CONFIG_B64` on the production trigger.
3. Limit the trigger to `main`; do not create a preview trigger backed by the production D1 database.
4. Leave the separate build command empty and use `bun run deploy` as the deploy command.
5. Enable build caching and pin the desired Bun version with a non-secret `BUN_VERSION` build variable when needed.

`scripts/prepare-production-config.ts` decodes the secret into a mode-`0600` file and rejects example values. The deployment command then runs checks, applies migrations, deploys, and verifies the live service.

Cloudflare build variables exist only during the build. Runtime secrets such as `SESSION_SECRET` and `BOOTSTRAP_TOKEN` remain Worker secrets and are not placed in the build variable.

## Upgrades

Manual upgrade:

```bash
git pull --ff-only
bun install
bun run deploy
```

With Workers Builds enabled, a push to `main` runs the same deployment command automatically.

Apply migrations before relying on code that expects the new schema. Never edit an already-applied migration; add a new numbered migration.

Regenerate Worker types after changing bindings or environment variables:

```bash
bun run cf:typegen
```

## Rollback

Record the deployed Git commit and migration state before an upgrade. Migrations run before the new Worker is uploaded, so migrations must remain backward-compatible with the currently deployed Worker.

For a code-only regression, deploy the previous known-good commit with the same production configuration. Do not reverse or edit an applied migration merely to roll code back.

For a schema or data regression:

1. stop or limit writes if continuing traffic can worsen the problem;
2. inspect the applied migrations and affected rows;
3. prefer a new forward migration when data remains valid;
4. use D1 Time Travel only after confirming the restore timestamp and acceptable data-loss window; and
5. deploy code compatible with the restored schema before resuming normal traffic.

A Time Travel restore replaces database state and can discard telemetry received after the selected point. Availability and retention depend on the account plan, so verify the current Cloudflare state before relying on it.

## Credential operations

### Ingestion key rotation

1. Create a new key in dashboard **Settings**.
2. Update the collector's private config.
3. Start or reload Pi and run `/traker-flush`.
4. Confirm the new key has a recent last-used timestamp.
5. Revoke the old key.

### Session-secret rotation

```bash
openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
```

This immediately invalidates dashboard sessions and pending WebAuthn challenges. It does not delete passkeys or ingestion keys.

### Bootstrap-token rotation

```bash
openssl rand -base64 32 | bunx wrangler secret put BOOTSTRAP_TOKEN --config wrangler.production.jsonc
```

This does not affect existing passkeys or sessions. The token is ignored for passkey registration while at least one passkey exists.

## Backup, retention, and deletion

Traker does not implement automatic telemetry retention. Define an operator policy appropriate for your deployment.

Export D1 only when required because exports contain repository labels and usage metadata:

```bash
bunx wrangler d1 export traker --remote --config wrangler.production.jsonc --output=traker-backup.sql
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
