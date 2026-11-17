# 00 — Fontes, consolidação e conflitos

## Fontes de verdade (desta solicitação)

- **F1 — PRD — Prompt & Skill Registry (11 págs.)**: objetivo, personas, MVP de 15 capacidades, fora de escopo, fluxos, aceitação, riscos.
- **F2 — RFC Técnico — Prompt & Skill Registry (13 págs.)**: serviços, SQL conceitual, invariantes de versões, resolvedor, cache, audit, outbox/webhooks, controles e erros.
- **F3 — Especificação de Produto e Engenharia (35 págs.)**: detalhes amplos de UI, API, papéis, modelo, observabilidade, escalabilidade-alvo e evolução.

Todos constam como **draft v0.1**. Quando o texto deste pacote for mais específico, é uma **proposta de implementação**, não um requisito já decidido nas fontes.

## Requisitos inequívocos do MVP (origem F1 §7, §14; F3 §19.1, §21; F2 §3)

R01 CRUD Prompt; R02 CRUD Skill; R03 versões imutáveis; R04 aliases staging/production; R05 escopos private/workspace; R06 diff; R07 rollback; R08 audit; R09 REST resolve; R10 playground; R11 test cases; R12 permissões básicas; R13 anexos textuais; R14 trace/versão resolvida; R15 webhook de publicação.

## Divergências e resolução proposta, sujeitas a validação

| Tema | Diferença documentada | Escolha para implementação | Impacto |
|---|---|---|---|
| Escopo de API | F2 `/v1` por família, F3 também menciona `/v1/ai-assets` | `/v1/prompts`, `/v1/skills` como contrato público; compartilhar módulo interno `/v1/assets` somente se necessário | APIs sem ambiguidade |
| Identificador único | F2 `UNIQUE(workspace_id,type,name)`; F1 fala nome único no workspace | `UNIQUE(workspace_id,type,name)` para aderir ao DDL; resolução requer tipo | evita quebrar F2 |
| Papéis | F1 Viewer/Editor/Owner/Publisher/Admin; F3 inclui Tester/Approver/Auditor | papéis-base F1 + permissões derivadas; Admin/Publisher aprovam quando configurado; Owner é vínculo de asset | RBAC simples |
| Revisão | F1 opcional por workspace; F3 recomenda aprovação independente para produção | política `require_review=false` no piloto, configurável para true; quando true não permitir autoaprovação | mantém fluxo viável para equipe pequena |
| Execução | F3 considera resolve-only/hosted/agent; F1 exclui MCP completo | **runtime resolve-only**; playground faz chamada LLM opcional isolada para Prompt; Skill não executa tools | risco/custo controlado |
| Anexos | F2 .md/.txt/.json até 1 MB/arquivo, máximo 10; F3 considera .csv/.pdf se parser | seguir F2 restrito, sem executáveis | reduz superfície de ataque |
| Hash de versão | F2 permite dedup por `UNIQUE(asset_id,definition_hash)` | definição JSON normalizada com ordem de chaves estável; notas da versão fora do hash | determinismo |
| Consistência cache | F2 sugere cache com TTL <=60s/invalidação; produção exige consistência | no piloto consultar alias direto no Postgres; adicionar cache só após medições | elimina stale alias |
| Identidade/multi-workspace | F2 modelo org/workspace; F1 escopo em workspace; F3 grande escala | schema suporta várias organizações/workspaces, operação inicial uma | sem overengineering operacional |
| Performance | F3 NFR p95 <50ms alias, 99,9% runtime, 100 QPS e 10M exec/mês | **registrar como metas originais não validadas**; critério do piloto é medição e operação para equipe interna; não alegar cumprimento enterprise | gate de dimensionamento futuro |
| Arquivos | F2 sugere object storage futuro | persistir anexos textuais pequenos no JSONB da versão + hash; migração futura para object storage | menos serviços |
| Estado do asset | F3 `draft` até `deleted`; F2 simplifica `active`/arquivado | status persistente `active/archived/deleted`, review/publicação derivadas de reviews/aliases | elimina estados inconsistentes |
| Test cases | F1 espera test run; F3 lista evals avançadas | validators determinísticos (schema/exact/contains/regex) + teste manual com LLM; sem judge | factível |

## Fontes por entregável
- Produto, perfis, 15 itens: F1 §§6–14, F3 §§1–11/19–21.
- Infraestrutura, tabelas, API, alias/consistência: F2 §§4–19, F3 §§12–13/17.
- UI: F3 §14 e F1 §10.
- Observabilidade, integração e segurança: F2 §§10–18; F3 §§15–17.
- Perguntas abertas: F2 §23 e F3 §24; documentadas no `12-decisions-risks.md`.

## Mudanças para aprovação antes da implementação

**Histórico da proposta v0.1, superada para implementação Cloudflare:** ADR-001 Next.js/Postgres e ADR-002 Auth externo eram alternativas antes da escolha posterior 100% Cloudflare. Ver decisões atuais em `12-decisions-risks.md`, stack vigente em `02-architecture.md` e mudanças em `16-cloudflare-source-deltas.md`.

## Adendo 2026-10-09: decisão posterior do usuário

O usuário escolheu 100% Cloudflare, alterando a infraestrutura proposta nos rascunhos F1/F2/F3. Fonte original fala em PostgreSQL/JSONB; D1 é uma **decisão posterior** e NÃO deve ser retroatribuída aos PDFs. Mudanças e riscos descritos em [`16-cloudflare-source-deltas.md`](16-cloudflare-source-deltas.md).