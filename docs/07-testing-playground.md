# 07 — Testes e playground com Workers AI

**Escopo:** preview determinístico local ao Worker, chamada manual à IA Cloudflare no playground, test case simples; sem agente autônomo nem execução de código de Skill.

- `preview`: render `{{variaveis}}` com placeholders declarados, required/default/tipos, output schema e erros; nunca `eval` nem HTML inseguro.
- `llm`: clique explícito executa `env.AI.run(modelId, payload)` via Workers AI binding; streaming opcional quando modelo escolhido suportar. Modelo/config só aceitos de allowlist testada, com limite de tokens, timeout, rate limit por usuário, estimativa de custo, orçamento.
- `Skill`: mostrar body, arquivos R2 validados e contratos; test case valida estrutura/regras textuais. `allowed_tools` declara permissões futuras, não dispara ferramentas.
- Casos determinísticos: equal, contains, JSON Schema output (se output existir); casos com IA só passam quando evidência de execução real do modelo escolhido existir; CI mock não conta como aprovação de produção.
- `ai_asset_test_runs`: asset/version/case_revision, resultado e hashes; inputs e outputs completos não persistidos por padrão (salvo fixtures consentidas em test case). Ao editar case, aumentar revision e invalidar aprovação anterior.
- Falha ou limite de Workers AI: preview ainda funciona; testar LLM mostra indisponibilidade, nunca falsificar PASS. Política `required_for_production` deve permanecer bloqueada se faltar teste válido.

## Gate

E2E: preview sem provider; Workers AI real em ambiente de staging com limite financeiro; skill upload/read pelo R2; rate limit; execução sem segredo em logs; caso alterado invalida run antigo.

Refs: https://developers.cloudflare.com/workers-ai/configuration/bindings/ e https://developers.cloudflare.com/workers-ai/models/