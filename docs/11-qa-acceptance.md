# 11 — Critérios de aceite e matriz de testes

Os 15 cenários abaixo são extraídos e normalizados do PRD F1 §14 e F3 §21; testados via UI/API em DB isolada com pelo menos Admin, Editor, Publisher e Viewer de dois workspaces. Nunca passar o teste apenas por botão escondido: fazer a requisição HTTP diretamente.

| AC | Cenário E2E | Evidência mínima |
|---|---|---|
| AC-01 | Criar Prompt privado | 201, v1, criador vê, outsider não |
| AC-02 | Criar Skill privada com .md | hash, arquivo textual, limite validado |
| AC-03 | Compartilhar com workspace | Viewer mesmo workspace vê após share; outro workspace não |
| AC-04 | Alterar conteúdo gera nova versão | v2 diferente de v1, hash distinto |
| AC-05 | Versão antiga continua acessível | GET v1 byte-equivalente e immutable |
| AC-06 | Production aponta para versão | publish autorizado, alias persistido |
| AC-07 | Runtime resolve por production | responde definição publicada |
| AC-08 | Retorna versão exata usada | trace contém resolved_version+hash+requested_ref |
| AC-09 | Comparar v1 e v2 | diff conteúdo/vars/assets corretos |
| AC-10 | Rollback production para v1 | CAS/justificativa/evento e nova resolve v1 |
| AC-11 | Audit criação/edição/publish/rollback | ator, tempo, before/after, request_id sem segredos |
| AC-12 | Sem permissão não publica | viewer/editor direto em API recebe 403/404; alias igual |
| AC-13 | Playground manual funciona | render e ao menos uma chamada real ao provider LLM configurado; run registrado. Sem provider disponível, AC-13 fica bloqueado, não aprovado |
| AC-14 | Test case simples funciona | passou/falhou com evaluator e versão correta |
| AC-15 | Webhook de publicação é enviado | HMAC verificável e delivery success; retry em 500 |

## Testes de regressão adicionais inegociáveis

- **AUTH-01** workspace cruzado via UUID, name, diff, test, trace, file e audit -> bloqueado.
- **VER-01** 2 saves concorrentes -> versões sequenciais sem colisão; dedup content hash; `UPDATE ai_asset_versions` rejeitado.
- **ALIAS-01** 2 publishes paralelos com CAS -> apenas 1 vence, uma resposta 409.
- **TX-01** induzir rollback de transação -> nem alias nem audit nem outbox persistem parcialmente.
- **OUTBOX-01** webhook 5xx -> pending/retry; webhook timeout; delivery repetida pelo mesmo event ID é tratável.
- **FILES-01** .exe, path traversal, polyglot com extensão permitida, >1MB, >10 files -> rejeitar; SHA validado.
- **SECRETS-01** API key de alta confiança bloqueada sem vN criado e com evento audit sanitizado.
- **TEMPLATE-01** variável faltante, duplicada, não declarada, template com `{{...}}` inválido -> erro; texto não executado.
- **TEST-01** required case falhando impede production; editar case invalida run anterior; sem caso não inventa pass.
- **RECOVERY-01** backup/restore em ambiente não produtivo reproduz versões e audit com integridade.
- **MOBILE-01** 375x812 e 390x844: catálogo/detalhe/editor/diff/publish/rollback sem corte e sem horizontal scroll global.

## Estratégia da pirâmide

Unit tests em domínio puro; integration tests em D1 local/preview, com SQLite batch/guards/CAS/trigger; E2E Playwright por persona; smoke/restore/load test em preview isolado. Mock apenas o provider LLM (para previsibilidade), não o banco em testes de concorrência. Snapshot tests não substituem invariantes.

## Gates CI sugeridos

`format-check` + lint + typecheck + unit + integration + E2E smoke + dependency audit básico + build + `git diff --check`. PR com migração exige fresh DB e migration-upgrade; PR com UI exige viewport mobile; PR com policy exige testes negativos.

## Release checklist

- [ ] Todas as AC-01..AC-15 passaram com link para run.
- [ ] Testes AUTH/VER/ALIAS/TX/OUTBOX/FILES/SECRETS/TEST/RECOVERY/MOBILE verdes.
- [ ] Limites e segredos revisados, sem credenciais no repo/log; rate limit ativado.
- [ ] Backup/restore ensaiado, observabilidade e owner de incidentes presentes.
- [ ] Docs, OpenAPI, schema, env, runbook e decisões sincronizados.
- [ ] Aprovador humano autoriza liberação; métricas piloto registradas.

## Gate extra Cloudflare 100%

Além dos 15 critérios do PRD: (1) Access browser/serviço verificado em preview real; (2) DB D1 migration local+preview; (3) SQLite append-only triggers; (4) CAS de version/production sob concorrência; (5) publish review/test gate transacional; (6) R2 privado e GC seguro; (7) Workers AI chamada real na allowlist; (8) webhook Queue + retry + DLQ + Cron recovery; (9) replay/idempotência; (10) restore D1 isolado; (11) domain workers.dev protegido, inclusive preview; (12) mobile 375px e 320px.