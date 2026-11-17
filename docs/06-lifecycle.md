# 06 — Ciclo de vida no D1/Cloudflare

A lógica de negócio dos PDFs permanece: ativo → snapshots imutáveis → alias de ambiente → testes/review → publicação → audit/trace → rollback. Esta versão troca transações Postgres/worker externo por D1, trigger e Queues.

## Criar Prompt ou Skill

1. Autenticar via Access/RBAC D1. 2. Validar slug, escopo e definition. 3. Scan anti-secret e validar tamanho. 4. Skill: validar anexos texto .md/.txt/.json (até 10 e 1 MB cada), hash e upload R2 privado. 5. Gerar canonical JSON + sha256. 6. D1 batch insere asset + v1; trigger insere audit/outbox. 7. Devolver asset id, version 1, hash. Duplicado por `workspace,type,name` gera 409.

## Criar versão

- Alterações de `definition` sempre geram versão inteira +1, metadata não. Canonical JSON hash igual ao existente retorna `deduplicated=true` sem criar versão extra. `version_write_guards` + batch D1 evitam lost update; `ai_asset_versions` tem trigger que bloqueia UPDATE/DELETE.
- Anexos por hash R2, manifest integral no snapshot; não permitir binários, scripts e executáveis.

## Staging, production, rollback

- Aliases só `staging`/`production`. Mover com version existente e `expected_revision`/`expected_current_version` (CAS) e motivo obrigatório para production e rollback.
- Checar review, testes obrigatórios da versão e revisão de test case **na operação transacional**, além de checagem anterior para mensagens claras.
- UPDATE/UPSERT cria auditoria e outbox por triggers; sem cache de alias. Rollback move pointer anterior sem recriar versão.
- Um erro de outbox bloqueia publicação (transaction rollback). Um erro de envio de webhook após commit **não** desfaz publicação: pendente fica no D1 até retry.

## Trace e execução

- Resolve retorna requested ref, `resolved_version`, `definition_hash`, trace_id, conteúdo renderizado para Prompt ou pacote de Skill. Gravar trace/resolução com mínimo de dados. Caller pode relatar execução associada ao trace, restrita por token/workspace.
- Playground Workers AI é apenas ação manual e isolada do resolve production; Skill não executa ferramenta nem código.

## Webhooks

- `asset.version_created`, `asset.published`, `asset.rollback`. O evento possui event ID estável, timestamp, sanitized payload, HMAC SHA256 e histórico de entrega por endpoint.
- Cron varre outbox D1 e encaminha a Queues; queue consumer com lease condicional e retries/DLQ. É **at-least-once**, consumidor externo deve ser idempotente.
- URL externa deve usar HTTPS, allowlist de domínio ou validação segura e DNS/redirect protections; não permitir SSRF via webhook livre.