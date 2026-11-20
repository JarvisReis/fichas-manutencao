# Publicação — fichas.rreis.app

## Como está no ar

```
Internet → Cloudflare Tunnel (cloudflared, root)
             ├─ fichas.rreis.app    → 127.0.0.1:4173  (nginx, arquivos estáticos)
             └─ fichasapi.rreis.app → 127.0.0.1:8787  (node server/sync-server.mjs)
```

- nginx serve `/var/www/fichas-metro` (build do Vite), systemd **de sistema**: `nginx.service`.
- A porta 80 da máquina é do **Pi-hole**. O nginx escuta só em 127.0.0.1:4173 — não conflita.
- O `vite preview` (`fichas-metro.service`, de usuário) foi **desativado**. Não religar: brigaria pela porta 4173.

## Publicar uma alteração

```bash
npm run build
npm run publicar      # rsync dist/ → /var/www/fichas-metro + reload do nginx
```

O `publicar` existe porque o home do ricardo é `700` e o nginx roda como `www-data`:
servir direto de `~/.openclaw/workspace/...` dá 403.

## Cache (importante)

- `/assets/*` tem hash no nome → `immutable`, 1 ano.
- `index.html` e `sw.js` → `no-store`, para o PWA não ficar preso numa versão antiga.
  Isso já custou um diagnóstico errado em 20/11/2026 (suspeitei de cache do aparelho
  quando o problema real era rota de leitura inexistente no servidor).

## Conferir

```bash
curl -s https://fichas.rreis.app/ | grep -o 'assets/index-[^"]*\.js'   # deve casar com dist/
curl -sI -H 'Accept-Encoding: gzip' http://127.0.0.1:4173/assets/<arquivo>.js | grep -i content-encoding
```
