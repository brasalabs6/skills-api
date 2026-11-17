# 03 — Modelo de dados D1/SQLite

O RFC e os PDFs usam PostgreSQL/JSONB. Nesta variante Cloudflare, preservamos o **modelo lógico**, mas migramos a tipagem e a atomicidade para D1/SQLite. DDL validável está em `db/schema.sql` e `migrations/0001_init.sql` (mesmo conteúdo de referência, nunca executado na nuvem nesta entrega).

## Conversão de tipos

| PostgreSQL de origem | D1/SQLite adotado | Verificação |
|---|---|---|
| UUID com gen_random_uuid | TEXT contendo UUID gerado pelo Worker | app valida UUID |
| JSONB | TEXT + `CHECK(json_valid(...))` | Zod valida schema antes do INSERT |
| TEXT[] | TEXT JSON array + `json_valid` | filtrar tags via join/JSON1, índices sobre colunas escalares |
| TIMESTAMPTZ | TEXT UTC RFC3339/ISO8601 | `Date.toISOString()` |
| BOOLEAN | INTEGER CHECK 0/1 | schema de resposta converte boolean |
| NUMERIC/cost | TEXT decimal preciso ou integer micros | app faz cálculo decimal |
| pgcrypto hash | `crypto.subtle.digest` no Worker | canonicalização + SHA-256 |
| trigger PL/pgSQL | trigger SQLite `RAISE(ABORT,...)` | teste de mutação |
| `SKIP LOCKED` | claim atômico por conditional UPDATE + lease | nunca ler e gravar sem CAS |

## Entidades

- `organizations`, `workspaces`, `users`, `workspace_members` (membership, papeis, status).
- `ai_assets` (metadata atual, owner, escopo, tipo, flags), `ai_asset_versions` (snapshot imutável JSON+hash), `ai_asset_aliases` (pointer CAS, revision, actor/motivo/action).
- `ai_asset_reviews`, `ai_asset_test_cases`, `ai_asset_test_runs` (snapshot de casos e evidência de testes).
- `ai_asset_audit_logs` (append-only), `ai_asset_executions` (traces), `service_tokens` (token hash/escopo), `webhook_endpoints`, `event_outbox`, `webhook_deliveries`, `idempotency_keys`.
- `skill_files` manifest content-addressed R2, `version_write_guards` como sentinel de transação para evitar lost update de versões.

## Regras de escrita crítica

- D1 `batch()` é transacional: se qualquer SQL falhar, reverte o lote. A API do D1 não é uma sessão PostgreSQL com `BEGIN/COMMIT` arbitrários expostos ao app; usar um batch com statements pré-preparados e triggers que falham em precondições obsoletas.
- Version create vN: inserir guard com `expected_latest_version=N-1`, atualizar `ai_assets.latest_version` CAS, inserir versão vN, deletar guard; o trigger de INSERT na versão cria audit/outbox. A transação inteira falha com 409 se houver versão concorrente ou definição hash duplicada; deduplicação por hash se resolve antes de tentar o INSERT, e conflito repetido é reconsultado.
- Alias staging/production: UPDATE condicional/UPSERT CAS com `expected_revision`, version FK; trigger gera audit/outbox no próprio write. Gates de revisão/teste precisam participar da condição transacional de publicação (ou trigger fail-closed); se update afetar 0, 409/422 conforme checagem atual. Publicação não depende de Queue estar disponível.
- Metadata mutável: estado + audit na mesma `batch`; testes de aborto mostram que nenhuma alteração persiste se falhar audit. Não guardar valores sensíveis em snapshots audit. `ai_asset_versions` e logs só INSERT.
- `R2`: manifest no D1 com `key`, `sha256`, `size_bytes`, `mime`; R2 privado com key `skill-assets/<workspace>/<sha>`, objeto nunca sobrescrito por conteúdos divergentes; GC somente de objetos não referenciados após janela segura.

## Consistência e retenção

- Aliases em produção são resolvidos no D1 primário (sem cache mutável), depois a versão imutável é carregada e seu hash retornado.
- Keys de idempotência: escopo `(workspace, actor, method, path, key)`, request hash, resposta sanitizada, expiração 24 h (proposta).
- Audit append-only e versões imutáveis são preservados; traces têm política de retenção a decidir antes de dados reais.
- SQLite FOREIGN KEY ON; joins/consultas sempre passam `workspace_id` e authorization context. D1 não possui Postgres RLS: aplicativo precisa checar acesso em cada rota.
- D1 backups/Time Travel: definir política e ensaiar restore para **um DB isolado** sem sobrescrever produção durante simulação.

Consulte `docs/15-d1-transactions.md` para exemplos e provas exigidas. As três fontes originais continuam preservadas em `sources/`.