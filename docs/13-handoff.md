# 13 — Handoff de implementação para agente

**Status:** documentação pronta para iniciar implementação, mas **nenhum projeto Cloudflare foi provisionado**.

## Brief do agente

Implementar o Prompt & Skill Registry para uso interno **100% Cloudflare**. O produto-base vem dos três PDFs em `sources/`. A arquitetura aprovada troca PostgreSQL por D1. Seguir `README.md`, `docs/01-prd-mvp.md`, `docs/02-architecture.md`, `docs/05-auth-and-policy.md`, `docs/10-roadmap.md`, `docs/11-qa-acceptance.md`, `docs/12-decisions-risks.md`, `docs/14-cloudflare-deployment.md`, `docs/15-d1-transactions.md` e `AGENTS.md`.

- Fazer bootstrap React Router v7 + Vite + Cloudflare Workers (não Next.js/Postgres); tipagem TypeScript, D1 migrations, R2, Workers AI, Queues/Cron e Access.
- **Implementar fatias verticais testáveis**: authz + D1 → assets+v1 → versions+hash+immutability → aliases CAS+audit/outbox → resolve+trace → diff/test+review → UI/R2/playground/webhooks.
- Respeitar OpenAPI, revisar schema ao implementar validações. `contracts/openapi.yaml` é contrato inicial, não executável por si.
- Não chamar `wrangler deploy --env production`, criar buckets/db remotos, fazer push ou merge sem pedido explícito.
- Não afirmar que teste SQLite local equivale a D1 Workers funcional; antes do release rodar E2E real e teste de Access + Workers AI + Queue sob preview.

## DoD

Todos os 15 critérios de aceite PRD e casos negativos Cloudflare passam, com evidência de DB init + upgrade, corrida transacional, webhooks HMAC at-least-once, sandbox de anexos sem executable, workers ai real quando solicitado, restore isolado, mobile 375px e CI verde.

## Decisões pendentes concretas

Domínio/hostname, identidade autorizada Access, modelo Workers AI e orçamento, `require_review` do piloto, contas/service token do consumidor de testes, destino webhook piloto, retention de logs.

## Primeiras issues

`REG-003` repo privado e branch protection; `REG-010` scaffold Cloudflare; `REG-011` D1 schema/migration/test; `REG-013/014` Access, RBAC e memberships; `REG-082..098` ajustes específicos. Não iniciar playground antes de auth, quotas e versão.