# 14 — Provisionamento e deploy Cloudflare (runbook proposto)

**Não executado neste pacote.** Comandos são roteiro para futuro bootstrap. Pré-requisito: conta Cloudflare com Workers, D1, R2, Queues e Workers AI liberados; permissão de Access/Zero Trust.

## Provisionar uma vez por ambiente

```bash
# Após autenticação no Wrangler (`npx wrangler login`) e na pasta do app implementado:
npx wrangler d1 create registry-preview
npx wrangler d1 create registry-production
npx wrangler r2 bucket create registry-assets-preview
npx wrangler r2 bucket create registry-assets-production
npx wrangler queues create registry-events-preview
npx wrangler queues create registry-events-production
npx wrangler queues create registry-webhook-dlq-preview
npx wrangler queues create registry-webhook-dlq-production
```

Copiar os IDs concretos do D1 para a configuração Wrangler gerada a partir de `wrangler.example.jsonc`. Configurar Access para **production e previews**, whitelist emails humanos e Service Auth para workloads. Criar segredo HMAC via `wrangler secret put ...` (ou secret store equivalente); não versionar segredo.

## Migrações

```bash
# No repositório final após setup do app:
npx wrangler d1 migrations apply registry-preview --local
# Na preview real:
npx wrangler d1 migrations apply registry-preview --remote
# Na produção: SOMENTE depois de backup/gate e aprovação:
npx wrangler d1 migrations apply registry-production --remote
```

Template inicial em `migrations/0001_init.sql`; testar no SQLite local e contra D1 local, não assumir que testes Python SQLite validem todos os detalhes D1.

## Builds e releases

1. Gerar app via `npm create cloudflare@latest -- registry --framework=react-router` (sem deploy inicial); integrar schema, contratos e pacotes do blueprint.
2. `npm ci && npm run lint && npm run typecheck && npm run test && npm run build` (scripts definidos no bootstrap).
3. E2E contra worker local + D1 local e mocks seguros; integração preview real com Access e Queues.
4. `wrangler deploy --env preview` somente quando autorizado; validar G0–G4 antes de `wrangler deploy --env production`.
5. Não promover código ou migrar banco ao mesmo tempo sem estratégia de compatibilidade. Pin `compatibility_date` e releases de dependências, revisar quota.

## Validação pós-deploy

- Access nega anônimo e email não autorizado; bearer token do Registry revogado falha, app caller com service auth + token válido funciona.
- 15 cenários PRD passam; versão imutável é rejeitada via SQL API; alias update CAS resiste corrida.
- Testar Queue consumer e redrive de pendentes via cron; entregar HMAC e verificar DLQ, bloquear URL maliciosa.
- R2 manifest para Skill resolve integridade; Workers AI executa modelo escolhido de verdade com orçamento.
- Backup/restore D1 ensaiado em banco isolado e métricas/logs visíveis.

## URLs oficiais

https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
https://developers.cloudflare.com/d1/get-started/
https://developers.cloudflare.com/workers/configuration/cloudflare-access/
https://developers.cloudflare.com/workers/configuration/cron-triggers/
https://developers.cloudflare.com/queues/get-started/
https://developers.cloudflare.com/workers-ai/configuration/bindings/