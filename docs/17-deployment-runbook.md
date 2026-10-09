# Provisionamento e validação — MVP Cloudflare

Estado observado em 2026-10-09: foram criados o D1 de desenvolvimento `skills-registry-dev`, o bucket R2 `skills-registry-assets-dev`, a fila `skills-registry-events-dev` e a DLQ `skills-registry-dlq-dev`. **Isso não significa aplicação implantada.** As migrações remotas ainda precisam ser aplicadas pelo Wrangler, com rastreamento de migrações. Não executar comandos de criação de tabelas isolados na API D1.

## Bloqueio de identidade (depende de ativação humana)
Cloudflare Access já foi habilitado. Foi criada a aplicação `skills-api-dev` para `skills-api-dev.guibelongtovi-a22.workers.dev`, com política *Allow owner only* restrita ao e-mail autorizado. Ainda é necessário testar o login real e a negação do usuário não autorizado antes do deploy final.

Após verificar a política de Access:
1. Garantir que a regra Cloudflare Access esteja associada ao hostname do Worker. Previews públicos estão desativados.
2. Usar os parâmetros reais da aplicação Access como secrets `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` (sem versionar).
3. Configurar `BOOTSTRAP_ADMIN_EMAIL` como secret, limitado ao usuário humano inicial autorizado. O bootstrap do banco só ocorre se ainda não existir usuário.
4. Gerar chave AES-256 aleatória codificada em base64 e gravar secret `WEBHOOK_ENCRYPTION_KEY`. Jamais usar chave de exemplo real.
5. Aplicar `npx wrangler d1 migrations apply DB --remote` e validar as tabelas.
6. Após Access proteger as rotas, executar o deploy com o Wrangler vinculado à conta correta. Não ativar publicamente rotas antes da política.
7. Testar com usuário autorizado e não autorizado; testar criação, edição, publicação, rollback, R2, Workers AI, fila, webhook e revogação.

## Local e CI
- `npm install`
- `npm run typecheck`
- `npm test`
- `python3 tests/sqlite_schema_smoke.py`
- `npm run build`
- `npx wrangler d1 migrations apply DB --local`

## API de aplicações
O token `reg_*` emitido pelo Registry autoriza somente os escopos internos escolhidos. Quando a aplicação estiver protegida por Access, chamadas automáticas precisarão **também** satisfazer a autenticação da borda, por exemplo via service token do Access. Um token não substitui o outro.

## Segurança
- Não commitar secrets, acessos pessoais ou credenciais Cloudflare. O repositório é público.
- Não alegar implantação funcional até validar os 15 critérios do PRD.
- Revisar deploy e plano de rollback antes de publicar.


## Estado de provisionamento atual (2026-10-09)
- Worker `skills-api-dev` criado com placeholder HTTP 503, **não é a aplicação final**; previews desabilitados.
- GitHub Actions de `5905e22`: testes TypeScript, Vitest, build, invariantes SQLite e migração D1 local aprovados.
- Cloudflare Builds ainda não está conectado ao GitHub. É necessário autorizar uma vez o **Cloudflare GitHub App** na organização/repositório `brasalabs6/skills-api` através do Dashboard. A API informou `8000008 ... project disconnected from your Git account`.
- Não publicar o Worker completo até que a Cloudflare tenha credenciais para buscar e construir o repositório, ou que exista um pipeline de deploy alternativo seguro.
