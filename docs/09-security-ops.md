# 09 — Operações, segurança e implantação 100% Cloudflare

## Superfície e ameaças

- Cloudflare Access protege interface e preview, sempre verificar identidade autenticada e membership D1; API de aplicações usa Service Auth na borda + token Registry (hash armazenado, escopos, revogação). Nunca confiar apenas em IP, workspace header ou texto de email não autenticado.
- D1 possui políticas no app, **não PostgreSQL RLS**; cada SELECT/UPDATE filtra workspace, owner/escopo e papel. Checks negativos entre dois workspaces, asset privado, alias e traces.
- Upload Skill: só `.md`, `.txt`, `.json`, até 1MB por arquivo, 10 por Skill, mime/UTF-8/json validado, hash, bloqueio de executáveis. R2 privado, chaves por SHA, sem browser link público direto.
- Scanner de secrets de alta confiança antes de criar versão; sanitizer de logs e webhook payloads. Sem credenciais em repo; segredo HMAC cifrado ou secret individual do endpoint protegido por Workers secret, nenhuma senha no D1 em claro.
- Rate limits por usuário/serviço nas rotas mutáveis e Workers AI; usar WAF/Rate Limiting conforme plano, com controle adicional aplicativo; restringir HTTP body, tokens IA e max concurrency.
- Webhook POST HTTPS com HMAC e event ID; bloquear localhost/IP privado, redirecionamentos inesperados, DNS rebinding e endpoints não autorizados. Preferir allowlist dos sistemas internos.
- CSP, CSRF protections, no wildcard CORS com credentials, no raw prompt injection in HTML.

## Logging

Workers Observability logs estruturados `{request_id,trace_id,workspace_id,asset_id,alias,resolved_version,actor_id,caller_app,status,error_code,latency_ms}` sem dados pessoais/inputs/outputs completos. Auditoria D1 é append-only e transacional. Métricas: p95 resolve, erro authz, version create, alias move, rollback, test run, fila e DLQ, latência Workers AI.

## Ambientes e provisioning

- `local`: Wrangler + D1 local `.wrangler`, R2 local emulado e mock AI nos testes.
- `preview`: Worker preview Access-protected + D1 preview isolado, R2 preview, Queue preview, secrets preview. Não copiar dados reais para preview.
- `production`: Worker sob Access + D1 prod + R2 prod + Queue/DLQ prod + Workers AI. Limitar pessoas no Access; domínio custom é opcional.
- Criar recursos com `wrangler d1 create`, `wrangler r2 bucket create`, `wrangler queues create`, configurar Access e secrets. Substituir IDs placeholder no wrangler template e armazenar secrets pelo ambiente, nunca em arquivos versionados.
- `wrangler d1 migrations apply ... --local` no CI smoke; `--remote` somente no deploy aprovado, após backup/restore practice. Separar migração da release Worker; rollback operacional via restore/forward fix, não downgrade destrutivo de versões.
- Worker App `fetch` e Worker jobs `queue`/`scheduled` separados ou agregados conforme scaffold. Cron mínimo 1 minuto para varrer eventos pendentes; throughput não requer broker externo.

## Runbook go/no-go

1. G0 decisões: modelo Workers AI e limite financeiro, identidades e subdomínio Cloudflare Access, env, custo/quotas.
2. G1: D1/Access/CI, testes auth. G2: concorrência/version/alias e atomicidade D1. G3: publish/review/rollback/Queue/DLQ/R2. G4: E2E mobile, cross-workspace, snapshots de backup/restore, SSRF e workload baseline.
3. Em staging real: criar Prompt + Skill, R2 file, versão v2, mover production, resolver API, playground Workers AI, webhook HMAC entregue, rollback production.
4. Em incidentes: desabilitar bearer exposto, pausar webhook endpoint, re-drive DLQ com idempotência, restaurar D1 para banco isolado e executar reconciliação. Para versionamento imutável nunca apagar versões como rollback de app.

Fontes: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ , https://developers.cloudflare.com/d1/ , https://developers.cloudflare.com/queues/ , https://developers.cloudflare.com/r2/ , https://developers.cloudflare.com/workers-ai/ .