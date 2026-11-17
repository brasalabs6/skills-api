# 12 — ADRs, decisões e riscos do Cloudflare-native MVP

## Decisão confirmada pelo usuário

- **D-01 [APPROVED]** — **100% Cloudflare**, sem PostgreSQL, Supabase, Vercel e serviços externos como dependências obrigatórias. D1 substituirá PostgreSQL dos PDFs.

## ADRs de implementação (propostos; não são promessas de suporte ilimitado)

| ID | Estado | Decisão/proposta | Alternativa/trigger |
|---|---|---|---|
| D-02 | PROPOSED | Cloudflare Access human auth + RBAC D1 + Registry API tokens | token Access Service Auth obrigatório se API exposta |
| D-03 | PROPOSED | React Router v7 + Vite Cloudflare em Workers | Next.js/vinext beta só após PoC de compatibilidade |
| D-04 | PROPOSED | Workers AI para playground; Skills apenas instruções, sem tools | manter preview se IA/quota indisponível |
| D-05 | PROPOSED | Review para production configurável por workspace, piloto `require_review=0` | dois revisores e política se exigido |
| D-06 | PROPOSED | Traces de input/output sem payload bruto; somente hashes e metadata | retenção explícita se armazenar payload |
| D-07 | PROPOSED | D1 primário para alias, sem KV/cache de pointer | introduzir cache invalidável apenas com métrica |
| D-08 | PROPOSED | R2 privado para anexos, SHA256 e GC órfão | D1 JSON inline (menor flexibilidade), não necessário |
| D-09 | PROPOSED | D1 outbox + Queues/DLQ + Cron a cada 1min | se Queues indisponível, polling Cron com mais atraso |
| D-10 | PROPOSED | Aliases fixos `staging/production` + versões inteiras monotônicas | custom aliases/semver adiados |
| D-11 | PROPOSED | Membros internos e escopos `private/workspace` | project/organization scopes futura evolução |
| D-12 | PROPOSED | Controle financeiro Workers AI: quota/token allowlist | bloquear inferência manual quando orçamento atingir limite |
| D-13 | PROPOSED | Hostname e Access policy única para browser e consumers | dividir API em segundo Worker/host CF se auth conflitar |

**Separar fonte e decisão:** PDFs PRD/RFC/produto exigem Postgres/JSONB como **arquitetura originalmente proposta**; o usuário mudou isso explicitamente. Requisitos funcionais originais continuam. Veja `docs/16-cloudflare-source-deltas.md`.

## Gate de decisão antes do provisionamento

1. Confirmar hostname/domínio (pode usar `workers.dev` sob Access) e quem acessará o Studio.
2. Escolher modelo Workers AI disponível, orçamento mensal e limite de requisições/tokens.
3. Confirmar se review é obrigatório em produção no piloto; se sim, garantir pessoa aprovadora distinta.
4. Definir níveis/tempo de retenção de executions/audit e owner da operação.
5. Definir consumidor piloto real do endpoint `/v1/.../resolve` e serviço que receberá webhook teste.

## Matriz de riscos

| Risco | Severidade | Mitigação/gate |
|---|---|---|
| D1 SQLite não compatível com Postgres SQL | ALTA | testar `migrations/0001_init.sql` em D1 local, sem SQL Postgres |
| Access validado só no frontend | CRÍTICA | middleware Worker + verificação JWT/ctx.access + testes forjados |
| Alias production incorreto após corrida | CRÍTICA | DB primário, UPSERT CAS, triggers audit/outbox, tests concorrência |
| Gate review/test race | ALTA | trigger/consulta transacional no mesmo write de publish |
| Queues entrega duplicada ou perde push | ALTA | D1 outbox/cron/retries/lease/idempotência |
| R2 object upload sem snapshot | MÉDIA | checksum e GC seguro de órfãos |
| LLM custos excedem budget | MÉDIA | orçamento, token limit e rate-limit |
| Webhook SSRF e secret leakage | ALTA | allowlist HTTPS, sem redirect, HMAC/secret encrypted |
| Imutabilidade quebrada | CRÍTICA | SQLite triggers + read-only admin/isolamento + testes |
| D1 backup restore acidental | ALTA | ensaio apenas em BD isolado, mudanças remotas aprovadas |
| Dependência de plano Cloudflare | MÉDIA | validar quotas e disponibilidade por plano antes de deploy |

## Adversarial checks não negociáveis

Cross-workspace por UUID/slug; user Header spoof; bearer token revogado; edição de uma versão antiga; dois alias CAS simultâneos; update com review/test stale; eventos duplicados; R2 blob órfão; webhook loopback/redirect; Workers AI sem binding/mode; D1 backup restaurado para ambiente distinto.