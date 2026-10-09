# 16 — O que mudou dos PDFs para Cloudflare

| Requisito dos PDFs | Implementação MVP Cloudflare | Natureza |
|---|---|---|
| Postgres / JSONB | D1 SQLite + JSON TEXT validado | **Desvio tecnológico aprovado** pelo pedido "100% Cloudflare"; sem mudança funcional pretendida |
| API REST + Studio | Worker React Router + REST /v1 | proposta técnica |
| Auth por organização/workspace | Access + RBAC D1 + Registry service tokens | proposta técnica |
| Aliases versionados consistentes | D1 primary + CAS/`batch`/triggers, sem KV para alias | adaptação técnica necessária |
| Audit append-only/outbox | SQLite triggers, D1 batch, Cron/Queues/DLQ | preservação do requisito |
| Arquivos Skill limitados | R2 privado SHA256, manifest no snapshot D1 | ampliação infra sem mudar limite |
| Playground | Workers AI, execução humana, allowlist e orçamento | escolha Cloudflare para modelo |
| Traces por versão exata | D1 com JSON/hashes e authz | preservação do requisito |
| Execução hospedada de agentes | **fora do MVP** | permanece fora do escopo original |
| Marketplace, MCP completo, canary, semver | **fora do MVP** | permanece conforme PRD |

**Importante:** os documentos F1/F2/F3 foram escritos para PostgreSQL e propunham escalabilidade empresarial. Esta variante escolhe D1 por decisão posterior do usuário; qualquer divergência implementacional deve ser documentada aqui e validada com os mesmos critérios de aceite, nunca atribuída às fontes como se elas tivessem especificado D1.