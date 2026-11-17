# 04 — API REST v1: contratos e exemplos

**Base pública:** `/v1`. Inspirada em F2 §15 e F3 §13. O arquivo `contracts/openapi.yaml` fornece modelo inicial OpenAPI. Não tratar contrato mínimo como implementação completa; ampliar schema/endpoint antes de codificar cada feature.

## Convenções

- HTTPS obrigatório fora de localhost; `Authorization: Bearer <token>` em integração; sessão Auth segura (cookie HttpOnly) na UI.
- `X-Workspace-Id` obrigatório quando o usuário tem mais de um; cabeçalho **não autoriza**: membership sempre verificada.
- UUIDs expostos e nomes slugs; quando `id_or_name` é nome, lookup condicionado ao tipo e workspace autenticado.
- Todas as mutações críticas aceitam `Idempotency-Key` (scope: actor+method+path+payload hash; janela 24h proposta).
- `X-Request-Id` aceito ou gerado; `trace_id` na resposta de resolve; paginação `?limit=25&cursor=...` com `limit<=100`.
- UTC RFC3339; custo em USD quando fornecido; sem converter moeda automaticamente.
- Erros `{"error":{"code":"...","message":"...","details":{}}}`; erro inesperado não revela stack/SQL.
- Padrões HTTP: 200 leitura/atualização, 201 criação, 202 operação assíncrona, 204 delete, 400 invalid, 401 unauth, 403 forbidden, 404 ocultar asset sem permissão, 409 conflito, 422 validation, 429 rate-limited, 5xx infra.

## Endpoints por família

| Método | Rota | Quem | Ação |
|---|---|---|---|
| GET/POST | `/v1/prompts` | Viewer/Editor | catálogo/criar com v1 |
| GET/PATCH/DELETE | `/v1/prompts/{id_or_name}` | autorizado | obter metadata+ref/editar metadata/soft-delete |
| GET/POST | `/v1/prompts/{id_or_name}/versions` | Viewer/Editor | listar/criar imutável |
| GET | `/v1/prompts/{id_or_name}/versions/{version}` | Viewer | snapshot específico |
| GET | `/v1/prompts/{id_or_name}/diff?from=1&to=2` | Viewer | diff |
| POST | `/v1/prompts/{id_or_name}/aliases/{alias}` | Publisher | mover staging/production |
| POST | `/v1/prompts/{id_or_name}/rollback` | Publisher | voltar alias |
| POST | `/v1/prompts/{id_or_name}/resolve` | service `resolve`/Viewer | conteúdo resolvido |
| GET/POST | `/v1/prompts/{id_or_name}/test-cases` | Viewer/Editor | listar/criar casos |
| POST | `/v1/prompts/{id_or_name}/test-runs` | Editor | executar teste |
| POST | `/v1/prompts/{id_or_name}/playground` | Editor | preview/LLM manual |
| * | `/v1/skills/...` | equivalentes | mesmos endpoints para Skills (Skill resolve retorna definition sem executar tool) |
| POST | `/v1/skills/{id_or_name}/files/validate` | Editor | validar arquivo antes da nova versão (sem código executável) |
| GET | `/v1/audit-logs` | Admin/authorized Owner subset | logs filtrados por workspace/asset |
| GET | `/v1/executions` | autorizado | traces/relatórios |
| POST | `/v1/executions` | token `executions:create` | report de execução pelo app após resolve |
| POST | `/v1/{prompts|skills}/{id}/reviews` | Editor | solicitar review |
| POST | `/v1/{prompts|skills}/{id}/reviews/{reviewId}/decision` | Approver | aprovar/rejeitar |
| GET/POST/PATCH/DELETE | `/v1/webhooks` | Admin | configurar destinos/alterar/desabilitar |
| GET | `/v1/webhooks/deliveries` | Admin | inspecionar status/retries |
| POST | `/v1/service-tokens` | Admin | emitir uma vez, armazenar hash |
| POST | `/v1/service-tokens/{id}/revoke` | Admin | revogar |
| GET | `/v1/health` | interno/infra | liveness; não vazar metadata |

F3 sugere `skills/discover`; **adiado**, pois descoberta semântica/agente completo está fora do MVP de F1. Se houver descoberta simples futura, especificar versão e comportamento por ADR antes de construir.

## Exemplos de payloads (UUIDs ilustrativos)

**Criar Prompt**
```json
{
  "name":"support-answer-style", "title":"Resposta de suporte",
  "sharing_scope":"private", "tags":["support"], "notes":"v1",
  "definition":{"content":"Olá {{customer_name}}. {{issue}}", "variables":[{"name":"customer_name","type":"string","required":true},{"name":"issue","type":"string","required":true}],"output_schema":null}
}
```
Resposta: `201 {"id":"<uuid>","type":"prompt","name":"support-answer-style","version":1,"deduplicated":false}`.

**Nova versão:** `POST .../versions` com `{"definition":{...},"notes":"Motivo claro", "expected_latest_version":1}`. Retorna `{asset_id,version:2,definition_hash,deduplicated:false}`; reenviar mesma definition retorna v2 e `deduplicated:true`. Se base divergiu: `409 version_conflict`.

**Publicar:** `POST .../aliases/production` com `{"version":2,"expected_current_version":1,"reason":"Testado e aprovado"}`. O primeiro publish usa `expected_current_version:null`. Resposta inclui `{asset_id,alias,version,previous_version,revision,moved_at}`.

**Resolver:** `POST /v1/prompts/support-answer-style/resolve`:
```json
{"ref":{"alias":"production"},"variables":{"customer_name":"Ana","issue":"Seu pedido está em análise."},"caller_app":"internal-app","environment":"prod"}
```
Resposta:
```json
{"asset_id":"<uuid>","name":"support-answer-style","type":"prompt","requested_ref":"production","resolved_version":2,"definition_hash":"<sha256>","rendered_content":"Olá Ana. Seu pedido está em análise.","trace_id":"<uuid>"}
```
Para Skill, `definition` é o pacote completo, assets são somente texto (com hashes) e ferramentas declaradas **não são executadas**.

**Reportar execução** (caller): `POST /v1/executions` `{ "resolution_trace_id":"<uuid>","status":"success","model":"model-name","latency_ms":340,"input_hash":"<sha256>","output_hash":"<sha256>","cost_usd":0.002 }`. Não aceitar reatribuir trace a outro workspace/app/token.

**Webhook:** corpo `{id,event,workspace_id,asset_id,type,name,alias,version,occurred_at}`; cabeçalhos `X-Registry-Event-Id`, `X-Registry-Timestamp`, `X-Registry-Signature: v1=<hex hmac sha256>`. Assinar `timestamp + '.' + rawBody`, proteger replay e idempotência no receptor.

## Validação

- `name`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80 chars (proposta).
- Exatamente um de `ref.version` ou `ref.alias`; permitir `version=1` explicitamente.
- Render `{{identifier}}` somente; variável não declarada, tipo incorreto, falta required e JSON schema inválido -> `validation_error`.
- `alias` somente `staging|production`; version number >= 1.
- `reason` obrigatório para production/rollback; notas não vazias para nova versão sem dedup.
- `status` e request context never client-authoritative.

## Códigos estáveis

`asset_not_found`, `version_not_found`, `alias_not_found`, `permission_denied`, `validation_error`, `duplicate_name`, `immutable_version`, `publication_blocked`, `test_required`, `secret_detected`, `alias_conflict`, `version_conflict`, `idempotency_conflict`, `rate_limited`. Não retornar payload secreto em `details`.

## Acesso na variante Cloudflare

Em produção, o hostname Worker deve ser protegido por **Cloudflare Access**. UI exige identidade humana verificada e RBAC D1. Integrações via REST exigem, quando Access protege API, **Access Service Auth no perímetro MAIS token bearer do Registry**, com `asset:resolve`/`executions:create` próprios; um substituto pelo outro é proibido. Continuam os mesmos payloads e erros do contrato original; `Authorization` bearer **não** é token administrador da Cloudflare. Detalhes em `05-auth-and-policy.md`.