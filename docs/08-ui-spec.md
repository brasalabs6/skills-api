# 08 — UI, fluxo humano e responsividade

## Design de produto

Studio limpo, orientado a tabela e detalhes; não confundir gerenciamento de prompt com editor IDE avançado. Cores e componentes neutros, densidade confortável, estados de erro claros. Cada ação destrutiva/relevante pede confirmação com versão e motivo. A aplicação é **desktop-first sem quebrar no celular**: o MVP será usado por uma equipe pequena inclusive em tela estreita.

## Mapa de navegação

```text
/login
/studio                 -> dashboard compacto / recentes
/studio/prompts         -> catálogo filtro type=prompt
/studio/skills          -> catálogo filtro type=skill
/studio/assets/new?type=prompt|skill
/studio/assets/:id       -> overview + editor + versions + tests + reviews + audit + executions + settings
/studio/assets/:id/diff?from=1&to=2
/studio/audit
/studio/executions
/studio/settings/members
/studio/settings/tokens
/studio/settings/webhooks
```

## Especificação por tela

| Tela | Elementos essenciais | Ações |
|---|---|---|
| Login | e-mail + invite/access, sessão visível | entrar/sair |
| Catálogo | busca, chips de filtros, tipo, owner, tags, aliased versions, test health, updated_at | abrir, criar, arquivar |
| Criar Prompt | nome slug/título/escopo, content, placeholders list, variável required/default/type, output schema opcional | validar/criar v1 |
| Criar Skill | nome/título/escopo, description “Use quando...”, body, tools declaradas, anexos texto com hash | validar/criar v1 |
| Overview | nome, owner, versão mais recente, aliases, última execução, teste status | testar, criar versão, promover |
| Editor | metadata separado do snapshot; histórico; diff preview; warnings secrets | salvar metadata ou criar versão (notas obrigatórias) |
| Versions/Diff | lista cronológica, comparação textual e JSON, assets changed, refs aliases | comparar, preview |
| Tests | test cases, run(s), latest per version, required flag | criar caso, rodar, ver erros |
| Playground | refs/version, variables, preview, botão executar com modelo (se configured) | render/test |
| Review | solicitante, reviewer, diff, checklist, status, comentário | aprovar/rejeitar |
| Publish/Rollback | alias atual/alvo/versão, testes e bloqueios, reason obrigatório, estado webhook posterior | confirmar |
| Audit/Executions | filtros por asset/tempo/ator/status, versões, trace, modelo, custo se disponível | inspeção |
| Settings | membros/papéis, tokens (uma visualização apenas), webhook endpoints/deliveries | convidar, revogar, desabilitar |

## UX nos estados de loading e erro

- Skeleton curto em listagem; ação de escrita com busy state e botão desabilitado somente durante request.
- Distinção visual `staging`, `production`, `archived` sem usar apenas cor (texto sempre visível).
- Erros de `version_conflict/alias_conflict`: exibir alvo novo e opção recarregar, não sobrescrever silenciosamente.
- Botão Publish bloqueado com razões específicas e links para teste ou permissão ausente.
- Ao criar versão, exibir aviso: **aliases não se movem automaticamente**.
- Quando evento estiver `pending delivery`, mostrar “publicado; notificação pendente”, não “falhou publicação”.

## Responsividade: critérios mínimos

- <=375px: sem rolagem horizontal do layout inteiro; tabelas podem virar cards; filtros em drawer; menu compacto; conteúdo diff por abas A/B em vez de duas colunas estreitas.
- 375–767px: editor textarea com min-width 0 e overflow; formulário em uma coluna; modal publish/rollback com conteúdo scrollable e botões acessíveis.
- Desktop >=1024px: tabela com filtros fixos; editor+preview lado a lado quando houver espaço.
- Touch targets >=44px recomendados; foco visível; teclado navegável; labels; confirmações acessíveis; ausência de ações somente no hover.
- Smoke real em mobile para criação de Prompt, criação de Skill, alias production, rollback, diff e leitura de audit.

## Fora do MVP de interface

Drag/drop workflow builder, diffs semânticos com IA, marketplace e descoberta inteligente de Skills, automação de canary, IDE de múltiplos arquivos e dashboards financeiros de custos.