# Agent instructions

- This repository is PUBLIC. Never commit secrets, user emails, Access application audience values, private keys or service tokens.
- The product must run 100% on Cloudflare (Workers, D1, R2, Workers AI, Access, Queues, Cron); do not introduce PostgreSQL, Supabase or Vercel.
- Every version is immutable, alias updates require CAS, publication requires RBAC and all required tests, critical events must append to audit and outbox transactionally.
- Validate: typecheck, unit tests, migration smoke, build, auth negative scenarios and API integration before release.
- Do not claim hosted AI agent execution: skills are reusable instructions and files; runtime resolve does not execute arbitrary tools.
- Keep staging and production isolated and never expose development bypass in deployed environment.
