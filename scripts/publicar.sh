#!/usr/bin/env bash
# Publica o build no nginx (127.0.0.1:4173, exposto por fichas.rreis.app).
#
# O nginx roda como www-data e o home do ricardo e 700, entao ele nao pode
# servir direto de ~/.openclaw/workspace. O build e copiado para /var/www.
set -euo pipefail

ORIGEM="$(cd "$(dirname "$0")/.." && pwd)/dist"
DESTINO="/var/www/fichas-metro"

# Porta de qualidade: sem typecheck, testes e build verdes, nao publica.
# (antes o script so conferia se dist/index.html existia)
if [ "${PULAR_CHECAGEM:-0}" != "1" ]; then
  echo "== typecheck =="
  npx tsc -b --noEmit
  echo "== testes =="
  npx vitest run --reporter=dot
  echo "== build =="
  npm run build
fi

if [ ! -f "$ORIGEM/index.html" ]; then
  echo "erro: $ORIGEM/index.html nao existe. Rode o build antes." >&2
  exit 1
fi

sudo rsync -a --delete "$ORIGEM/" "$DESTINO/"
sudo chown -R www-data:www-data "$DESTINO"

# recarrega so se o config mudou; o conteudo e lido do disco a cada request
sudo systemctl reload nginx

echo "publicado: $DESTINO"
ls -1 "$DESTINO/assets" | grep '^index-.*\.js$'
