# Prompt & Skill Registry

Internal Prompt and Skill registry running entirely on Cloudflare: Workers, D1, R2, Access, Workers AI, Queues, Cron.

## Status

Implementation in progress. The GitHub repository is PUBLIC: **never commit real secrets, tokens, or live configuration identifiers**.

## Local

1. Install Node 22 and npm packages with `npm install`.
2. Create D1/R2/Queue resources on Cloudflare and set the IDs in `wrangler.jsonc`. For local development use preview resources.
3. Run `npx wrangler d1 migrations apply registry-dev --local`.
4. Configure Cloudflare Access, then set `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `WEBHOOK_ENCRYPTION_KEY` with Wrangler secrets in deployed environments.
5. Run `npm run dev` and `npm test`.

No password login. Access validates identities; only an authenticated email matching BOOTSTRAP_ADMIN_EMAIL may provision the initial admin once. All other members are explicitly added by an admin. A separate Registry service token is required by API clients in addition to Cloudflare Access service authorization.

See docs/ and contracts/ for architecture and runtime contracts.
