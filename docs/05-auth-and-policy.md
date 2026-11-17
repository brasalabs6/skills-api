# 05 — Segurança de acesso: Cloudflare Access + RBAC D1

**Separação fundamental:** Cloudflare Access autentica o humano (ou o serviço permitido na borda). O Registry autoriza cada ação, workspace, scope, ativo e alias com dados próprios em D1.

## Identidades humanas

- UI em hostname protegido pelo **Cloudflare Access**; permitir emails do time explicitamente, incluindo URL de preview. Nunca expor endpoints por hostname alternativo desprotegido.
- Obter a identidade **verificada** via contexto Access (`ctx.access.getIdentity()` quando disponível) ou validação JWT apropriada ao roteador. Nunca aceitar `Cf-Access-Authenticated-User-Email` ou outro cabeçalho sem verificar procedência/assinatura. `ctx.access` não é propagado via Service Bindings e há particularidades de roteamento Static Assets: testar o framework escolhido integrado com Access antes de liberar.
- Vincular ID estável de usuário a identidade Access autenticada. Provisionar `users` + `workspace_members` por admin; sem auto-provisionamento livre. Emails não autorizados = 403.
- App precisa de proteção CSRF em mutações com sessão do navegador: `Origin`/host allowlist + token se necessário, cookies SameSite e negação a CORS cross-origin. Access não substitui verificação RBAC.

## Consumo por aplicações e agentes

- **Service tokens do Registry:** valor aleatório forte com hash em D1, escopos `asset:resolve` e `executions:create`, workspace restrito, expirável, revogável. Não usar token Cloudflare API com permissões da conta.
- Cloudflare Access na frente da API aceita fluxo machine-to-machine via Service Auth **quando configurado**; separadamente o backend checa token do Registry. Para o MVP, mesmo hostname para UI e API, Access configurado para human login + serviços, com testes reais de integração via curl e app caller. Se complicar, criar Worker/hostname de API próprio ainda sob Cloudflare Access; não abrir UI anonimamente.
- Em toda rota `asset.read`, `asset.create_version`, `asset.publish`, workspace ID só serve de filtro, nunca de prova de autorização. Negar acesso cross-workspace em todas as relações.

## Compartilhamento

- `private`: criador, owner e Admin do workspace. Não expor a tokens de serviço por padrão.
- `workspace`: membros ativos autorizados no workspace; service token resolve somente quando com escopo e asset compartilhado.
- `archived/deleted`: bloqueio de resolução nova; histórico preservado para owner/admin.

## RBAC

| Ação | Viewer | Editor | Owner | Publisher | Admin | token Registry |
|---|---|---|---|---|---|---|
| Ler asset visível | sim | sim | sim | sim | sim | com `asset:resolve` se workspace |
| Criar Prompt/Skill | não | sim | sim | sim | sim | não |
| Metadata / nova versão / testar | não | sim (visível) | sim | sim (visível) | sim | não |
| Publicar `staging` | não | sim (visível) | sim | sim | sim | não |
| Publicar `production` e rollback | não | não | não | sim | sim | não |
| Aprovar revisão (se habilitada) | não | não | não | sim (autor diferente) | sim (autor diferente) | não |
| Admin tokens/webhooks | não | não | não | não | sim | não |
| Ver auditoria completa | não | não | próprio asset | não | sim | não |
| Reportar execução | não | não | não | não | sim | com `executions:create` |

**Policy:** `production` exige motivo + publisher/admin + testes obrigatórios atuais verdes + aprovação se `workspace.require_review=1`; aprovação não pode ser feita pelo autor da versão. Rollback exige mesmo RBAC e motivo; override emergencial por Admin é decisão específica registrada/auditada, não padrão. Triggers/guard transacional devem impedir corrida entre checagem e escrita.

## Casos negativos essenciais

1. Acesso a UUID/slug de outro workspace retorna 404 sem vazar dados.
2. `private` inacessível por outro membro do mesmo workspace e por service token.
3. Viewer/Editor não publica `production` via API, mesmo que UI esconda botão.
4. Token do Registry revogado rejeitado imediatamente, sem cache da revogação.
5. Ambiente de preview não compartilha tokens R2/D1/Queue/Access de prod.
6. Headers forjados de identity e Origin cross-site não autorizam mutação.
7. Service Auth no perímetro e bearer token Registry NÃO equivalem a Admin.