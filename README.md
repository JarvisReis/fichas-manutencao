# Fichas de Medição

PWA offline-first para as fichas de medição de contator e seccionador.

## Fichas cobertas

| id | equipamento | pontos | tipos de manutenção |
|---|---|---|---|
| `CT-BI` | Contator BI (ficha CT01) | 5 | P1, P2 |
| `CT-FICHA` | Contator por marca (Merlin Gerin / Schneider) | 8 | P1, P2 |
| `SC-BI1` | Seccionador BI 1 | 5 | P2 |

## Rodar

```bash
npm install
npm run dev -- --host    # acesse pelo celular em http://IP:5173
```

## Verificar

```bash
npx tsc -b        # tipos
npx vitest run    # regras de conformidade
npm run build     # produção (dist/ com service worker)
```

## Onde mexer

- `src/config/fichas.ts` — itens, limites, unidades e instrumentos de cada ficha. Novo equipamento = novo objeto aqui.
- `src/lib/conformidade.ts` — regra de comparação (mín/máx, infinito, N/A por marca).
- `src/lib/db.ts` — persistência local (IndexedDB/Dexie) e compressão de foto.

## Pendente

- Sincronização com SharePoint (proxy no Raspberry + App Registration `Sites.Selected`).
