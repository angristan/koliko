# Development

## Local setup

```bash
bun install
cp .dev.vars.example .dev.vars
# Set independent BOOTSTRAP_TOKEN and SESSION_SECRET values.
bun run db:migrate:local
bun run dev
```

Open the URL printed by Vite and register a local passkey. The Cloudflare Vite plugin runs the Worker, bindings, dashboard, and HMR together in Workerd. Exercise WebAuthn on that single origin because the relying-party ID and browser origin must match.

## Demo data

Add 90 days of deterministic demo activity:

```bash
bun run db:seed:local
```

The seed command replaces only its own data when rerun.

## Validation

```bash
bun run verify
```

This checks generated Worker types, TypeScript, unit and Workerd integration tests, the Vite production build, and a Wrangler dry run. Workerd tests apply every D1 migration to isolated local storage.

Regenerate Worker types after changing bindings or environment variables:

```bash
bun run cf:typegen
```
