# 01 — PRD do MVP interno

## Visão e problema

**Visão:** fonte central versionada para instruções de IA consumidas por times, automações e aplicações internas. Problemas: prompts hardcoded/duplicados, mudanças sem autor identificável, ausência de rollback, produção sem saber versão, falta de testes e trilha.

**Objetivo de uso interno:** dois ou mais colaboradores conseguirem editar ativos sem mudar código dos apps consumidores; um agente/aplicação receber exatamente a definição publicada por alias, com trilha de auditoria. Não é plataforma de hospedagem de agentes.

## Personas e permissões

- **Viewer:** consulta catálogo/versões que consegue enxergar.
- **Editor:** cria assets/versões, edita metadata, executa playground/testes.
- **Owner:** dono do asset; gerencia conteúdo/configurações do próprio asset e pode compartilhar dentro das políticas; não ganha automaticamente permissão de publicação.
- **Publisher:** move aliases de produção, realiza rollback, pode analisar revisões se política habilitada.
- **Admin:** administra workspace, pessoas, tokens, webhooks e auditoria; poder de recuperação.
- **Chamador de API:** service account com token de curta/longa vida revogável, escopado para workspace e ações `resolve` / `executions:create`.

## Jornada central

1. Editor autentica e cria um Prompt privado `support-answer-style`, define variáveis e recebe v1.
2. Editor altera definição e salva com notas, gerando v2; v1 permanece legível.
3. Editor compara v1/v2, faz preview, cria test case e testa.
4. Owner torna o asset visível no workspace; Publisher move staging -> v2.
5. Publisher publica production -> v2 com justificativa, sujeito a política/testes. Alias move, audit e outbox são atômicos.
6. Serviço consumidor resolve `support-answer-style@production`, recebe v2 exata + hash/trace; usa no próprio LLM.
7. Se mudança degradar resposta, Publisher faz rollback production -> v1 com justificativa; cliente resolve v1 imediatamente.
8. Usuários consultam histórico, execuções reportadas e falhas de webhook.

## Catálogo e UX

- Busca e filtros por tipo, texto, owner, tags, status, escopo, alias, criador e atualizado.
- Linha mostra nome, tipo, título, owner, latest_version, staging/production, status, última modificação e indicador de teste.
- Edição claramente separa **metadata mutável** de **conteúdo imutável**.
- Botões inativos quando faltarem permissões; backend **sempre** valida de novo.

## Contratos de dados do domínio

**Prompt**: metadata `{name,title,description,tags,sharing_scope}` + definition `{content, variables:[{name,type,required,default?}], output_schema?, model_config?, guardrails?, examples?}`. Declarações de variáveis devem corresponder a placeholders `{{name}}` e renderização não deve permitir expressões executáveis.

**Skill**: metadata comum + definition `{description,body,assets:{filename:{text_content,is_executable:false,content_hash}},allowed_tools:[],input_contract?,output_contract?,guardrails?}`. `description` equivale ao texto de ativação da Skill; não é metadado mutável.

**Versão:** snapshot com inteiro monotônico, `definition_hash`, autor/data/notes. **Alias:** ponteiro único por asset+nome; `staging` e `production` suportados (podem ficar inicialmente ausentes). **Rollback:** nunca modifica versão anterior.

## Requisitos funcionais com IDs

| ID | Descrição | Criticidade |
|---|---|---|
| FR-01 | Criar/listar/ler/editar metadata/arquivar/soft-delete Prompt | Must |
| FR-02 | Mesmo fluxo para Skill com anexos textuais | Must |
| FR-03 | Criar/obter/listar versões imutáveis, hash/dedup, notas | Must |
| FR-04 | Mover staging/production e resolver exato version/alias | Must |
| FR-05 | Visibilidade private/workspace e papéis com isolamento | Must |
| FR-06 | Diff textual + JSON estrutural entre versões | Must |
| FR-07 | Rollback production mediante motivo e autorização | Must |
| FR-08 | Audit log append-only e consulta autorizada | Must |
| FR-09 | API authenticated para retornar definição e renderizar Prompt | Must |
| FR-10 | Playground preview; execução manual LLM de Prompt quando configurado | Must |
| FR-11 | Criar/rodar test cases simples e armazenar resultados | Must |
| FR-12 | Tokens por workspace e revogação | Must (decisão engenharia) |
| FR-13 | Upload .md/.txt/.json, 1 MB cada, até 10 na Skill | Must |
| FR-14 | Log de resolução e registro reportado de execuções downstream | Must |
| FR-15 | Webhook publish/rollback/version, com retry observável | Must |
| FR-16 | UI mobile utilizável para consultas/publicação crítica | Should (critério operacional) |
| FR-17 | Revisão simples habilitável por política | Should (PRD: opcional) |
| FR-18 | Importação manual de conteúdo existente | Could (F2 migração) |

## Não objetivos

Sem marketplace, sem semver, sem multi-região, sem agent-runtime, sem MCP server, sem código arbitrário ou shell a partir de Skill, sem descoberta semântica automática, sem workflow builder, sem aprovação complexa, sem LLM judge, sem A/B ou canary automático, sem PDF/CSV anexados nesta fase.

## Critérios de sucesso do piloto

- Todos os 15 cenários documentais de aceite cobertos por testes funcionais; nenhum bypass de autorização crítico.
- Pelo menos 1 Prompt e 1 Skill reais publicados e consumidos por um cliente de teste; evidência de resolved_version.
- Rollback validado de ponta a ponta, incluindo evento persistido e entrega webhook.
- Sem perda de versions/audit em falhas simuladas; zero segredo de demonstração no repositório/log.
- Métricas de latência e erro instrumentadas; metas enterprise da F3 permanecem **aspiracionais**, não condição não medida para piloto.

## Instrumentação da adoção

Nº assets/versions, % com owner, % published, resoluções por alias, rollbacks, taxa de testes verdes, p95 resolve, falhas da API/webhook e % de resoluções com trace; acompanhar semanalmente sem armazenar payload sensível por padrão.