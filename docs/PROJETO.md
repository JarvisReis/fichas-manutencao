# Projeto — Fichas de Medição

PWA offline-first para as fichas de medição de contator e seccionador, usada em
campo pelos técnicos. Este documento é o mapa mínimo para alguém assumir o
projeto sem redescobrir o caminho.

## Onde as coisas vivem

```
/home/ricardo/projetos/fichas-manutencao   código (repositório próprio)
  src/pages                  telas (TelaHome, TelaExecucao, TelaCadastros, ...)
  src/lib                    regras de negócio + acesso a dados (Dexie, sync, PDF)
  src/components             componentes compartilhados
  src/config                 definição das fichas cobertas
  server/sync-server.mjs     API de sincronização (Node, serviço de sistema, :8787)
  supabase/schema.sql        tabelas, RLS e função meu_nivel()
  scripts/publicar.sh        gate de qualidade + publicação
/var/www/fichas-metro        conteúdo servido pelo nginx (dono www-data)
/etc/nginx/sites-available/fichas-metro   listen 127.0.0.1:4173
/etc/fichas-sync.env         variáveis do sync-server (inclui a service role)
```

- Domínio: `fichas.rreis.app` (Cloudflare Tunnel → nginx local). API em
  `fichasapi.rreis.app`. A porta 80 do host é do Pi-hole — não usar.
- `netlify.toml` existe no projeto, mas quem serve é nginx + túnel.

## Como rodar e verificar

```bash
npx tsc -b --noEmit                  # typecheck
npx vitest run --reporter=dot        # testes (baseline: 85 em 10 arquivos)
npx oxlint                           # lint (baseline: zero avisos)
npm run build                        # build de produção
```

## Como publicar

Somente pelo script, que roda typecheck, testes e build antes de copiar:

```bash
bash scripts/publicar.sh                     # normal
PULAR_CHECAGEM=1 bash scripts/publicar.sh    # emergência, sem gate
```

Prova de que a publicação pegou:

```bash
curl -s https://fichas.rreis.app/ | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1
grep -o 'index-[A-Za-z0-9_-]*\.js' /var/www/fichas-metro/index.html | head -1
```

Os dois hashes precisam bater. A API deve responder 401 sem token:
`curl -s -o /dev/null -w '%{http_code}\n' https://fichasapi.rreis.app/fichas`

## Dados e autorização

- Aparelho: IndexedDB via Dexie (fonte de verdade offline).
- Sincronização: app → sync-server (JWT do Supabase) → Supabase Cloud
  (projeto `xmjrpyugrcwlehjqgcqx`).
- Nível de acesso por pessoa na tabela `public.perfis`
  (`administrador` / `usuario`), com RLS. A autoria de uma execução é sempre o
  dono do token, nunca um campo do corpo da requisição.

## Credenciais (nunca em arquivo versionado)

- `.env.local` (600): apenas `VITE_*`, que são públicas por desenho.
- `/home/maleta/Configurações/fichas-secrets.env` (600): service role, senha do
  banco e afins, só para scripts administrativos.
- `/home/maleta/Configurações/fichas-admin.txt` (600): conta administradora do
  app.
- `/etc/fichas-sync.env`: o que o serviço de sync consome em produção.

## Regras de trabalho

1. Mudança em produção só com o gate verde (typecheck + testes + build).
2. Uma linha de changelog por versão, citando o hash do bundle publicado.
3. Alteração de schema/RLS: registrar o SQL aplicado em `supabase/` antes de
   rodar, e avisar o usuário.
4. O repositório também guarda estado do agente (`AGENTS.md`, `MEMORY.md`) do
   outro assistente que roda nesta máquina. Commit do app deve incluir só os
   arquivos do app (`git add` por caminho, nunca `git add -A`).

## Pendências conhecidas

- Separar o app do workspace do agente em repositórios distintos.
- Quebrar os arquivos grandes: `TelaCadastros.tsx` (986 linhas),
  `TelaIdentificacao.tsx` (868), `App.tsx` (812), `TelaHome.tsx` (789).
- Confirmar se a Netlify ainda é destino de deploy ou apenas resíduo.