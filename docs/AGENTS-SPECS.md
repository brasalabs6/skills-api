# Instruções permanentes para agentes neste repositório

O repositório é **uma especificação até a implementação começar**. Não confundir blueprint com código existente/testado. Tratar os 3 PDFs citados no README como fontes da intenção do produto e as decisões em `docs/12-decisions-risks.md` como propostas de engenharia até aprovadas.

## Protocolo obrigatório
1. Antes de modificar código, ler README, PRD, arquitetura, API, segurança, roadmap, DoD, decisões e mudanças recentes. Confirmar estado real de arquivos, CI, migrations e deploy.
2. Construir modelo objetivo → entregável → épico → tarefa → dependências → gate → cenário alternativo. Se surgir conflito, documentar ADR e levantar gate, nunca inventar decisão.
3. Cada PR deve corresponder a tarefa `REG-###`, manter o escopo mínimo funcional, incluir testes relevantes e atualizar contrato, migração, docs e riscos na mesma alteração quando necessário.
4. Código server-side autoriza **todas** as ações (não confiar em botões escondidos), filtra sempre por workspace e escopo; nunca aceitar workspace do header como prova de pertencimento.
5. Nunca atualizar conteúdo de `ai_asset_versions`; criar nova versão ou deduplicar por hash. Alias muda transacionalmente com audit e outbox; protegê-lo contra corrida.
6. Não logar bearer tokens, secrets, conteúdo sensível do usuário, entradas/saídas de LLM no modo padrão. Logs estruturados com request_id/trace_id.
7. **Sem execução de scripts anexados**; sem comandos shell disparados pelo conteúdo de Skill; sem interpolação de template por JavaScript arbitrário.
8. Não colocar segredos no repositório, nem credenciais padrão/de demonstração utilizáveis. Arquivo `.env.example` sem valores secretos.
9. Não implementar features futuras disfarçadas de requisitos MVP: marketplace, MCP completo, LLM-as-judge, agente autônomo, semver, canary automático.
10. Sem push/merge/deploy/publicação sem autorização explícita na sessão de execução.

## Gates de qualidade
- Unit/integration/E2E para fluxos mudados; build, lint, typecheck e `git diff --check` verdes.
- Migrations forward-only; teste de fresh DB, upgrade e rollback **operacional** via backup/forward fix.
- Contrato REST e códigos de erro atualizados; autorização e cross-tenant negativo cobertos.
- Documentar quais testes foram realmente executados e o que permanece não verificado.

## Estados de tarefas
Usar `READY`, `ACTIVE`, `BLOCKED`, `WAITING_DECISION`, `WAITING_EXTERNAL`, `DONE`, `DEFERRED`, `SUPERSEDED` e IDs estáveis `REG-###`. Não marcar DONE somente por ter criado arquivos: verificar DoD e evidência.

## Decisão permanente Cloudflare

A partir de 2026-10-09, a arquitetura de implantação é **100% Cloudflare**. Implementar com Workers/React Router 7, D1 SQLite, R2, Access, Workers AI e Queues/Cron. **Não** reintroduzir Next.js+Postgres/Supabase/Vercel como dependências sem ADR e nova aprovação. Consultar `docs/15-d1-transactions.md` antes de escrever serviços de versão/alias e `docs/14-cloudflare-deployment.md` antes de tocar recursos reais. `wrangler.example.jsonc` tem placeholders e não autoriza deploy. Preservar referências de fonte (`sources/`) e aceites.