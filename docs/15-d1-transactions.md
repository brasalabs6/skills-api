# 15 — Padrões críticos de transação em D1 (implementação obrigatória)

## Por que não portar SQL Postgres cegamente

D1 é SQLite. As garantias da fonte (versões imutáveis, CAS, rollback, auditoria, outbox) **devem permanecer**, mas `FOR UPDATE`, row locks e RLS do Postgres não fazem parte do produto. `D1Database.batch()` roda statements em uma transação única e reverte todos em erro. Ver https://developers.cloudflare.com/d1/worker-api/d1-database/#batch .

## Criar versão vN sob corrida

```ts
// PSEUDOCÓDIGO de integração; ajuste nomes/retornos ao SDK instalado.
const next = expectedLatest + 1;
const stmts = [
  db.prepare(`INSERT INTO version_write_guards(id, asset_id, workspace_id, expected_latest_version)
    VALUES(?,?,?,?)`).bind(opId, assetId, workspaceId, expectedLatest),
  db.prepare(`UPDATE ai_assets SET latest_version=?, updated_at=?
    WHERE id=? AND workspace_id=? AND latest_version=?`)
    .bind(next, now, assetId, workspaceId, expectedLatest),
  db.prepare(`INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,notes,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .bind(versionId,assetId,next,canonicalJson,hash,notes,actorId,now),
  db.prepare(`DELETE FROM version_write_guards WHERE id=?`).bind(opId),
];
await db.batch(stmts); // Se precondição falhar, rollback no lote inteiro.
```

O trigger `guard_versions_precondition` falha se expectedLatest != actual. O trigger `versions_audit_event` insere audit e outbox na criação. Precisamos provar com concorrência de chamadas simultâneas que uma só vence e outra retorna 409; o erro `UNIQUE(asset_id,definition_hash)` deve levar a reconciliação de dedup por hash, não a vN extra.

## Mover alias de forma atômica

Operar `INSERT ... SELECT` (primeiro alias) e `INSERT ... ON CONFLICT DO UPDATE ... WHERE ai_asset_aliases.revision = ? RETURNING ...` (posteriores). Para primeiro movimento, `expected_current_version=null`; para posteriores, exigir `expected_revision`/`expected_current_version`. Triggers AFTER INSERT/UPDATE geram audit e outbox quando `alias=production`; ambos participantes da mesma transação. Se UPSERT afetar 0 linhas, recarregar revision, retornar 409 e nunca emitir evento.

**AVISO obrigatório:** policy/read review/test deve ser revalidada **dentro da mesma transação ou no statement de UPSERT via predicados `EXISTS`** para impedir race do tipo teste marcado como obrigatório após pré-check e antes do commit. Edição de test case incrementa `case_revision` e invalida run anterior.

## Outbox/Queue

1. Publish write muda alias + trigger cria audit/outbox (atomicidade DB).
2. Após commit, `queue.send({event_id})` best effort para reduzir atraso. Falha de queue NÃO descarta outbox.
3. Cron `* * * * *` lista eventos ready e faz claim atômico `UPDATE ... SET lease_until = ? WHERE id=? AND (lease_until IS NULL OR lease_until < NOW) RETURNING ...`. Se falhar CAS outro worker ganhou.
4. Queue consumer recebe somente event ID, checa endpoint/delivery, assina body com segredo e manda `fetch` HTTPS; retries/backoff/DLQ visíveis. Para concorrência de 2 consumidores: claim lease no D1 por deliveryId, não enviar se claim já ativo.
5. Cliente pode receber duplicado se ACK de rede falhar; `X-Registry-Event-Id` estável, receptor deve deduplicar. Não existe 100% exactly-once nos webhooks.

## Alias resolve

Ler metadata + alias + versão numa leitura consistente do D1 primário; não usar KV para `production`. Se usar Sessions, escolher `first-primary` para operações críticas. Registrar `resolved_version` exata e hash antes de retornar; o evento de trace não deve alterar qual conteúdo foi resolvido.

## Anexos R2

O hash manifesto de R2 é armazenado junto à versão. Depois de escrever blob (fora da transação), verificá-lo. Se INSERT de D1 falhar, R2 pode manter objeto órfão, que será limpo por scanner de órfãos depois da janela de segurança. Nunca deletar objeto presente em qualquer snapshot de versão.

## Testes de integridade (G2)

- Dois POST simultâneos com `expected_latest_version=1` → exatamente uma v2 criada; outra 409 ou dedup sem nova versão.
- Dois publish concorrentes com `expected_revision=2` → um vence; outro 409; audit/outbox exatos por movimento vencedor.
- Trigger audit/outbox falha simulada → publicação revertida.
- Queue indisponível → publicação persiste, outbox cron envia posteriormente; nenhum evento perdido.
- Idempotency-Key repetida com payload diferente → 409; repetida idêntica → mesma resposta.
- R2 blob órfão → GC remove sem remover blobs ainda referenciados.