import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { FICHAS } from '../config/fichas'
import { fichaEmVigor, type FichasAjustadas } from '../lib/fichasEditadas'
import type { DefinicaoFicha, Direcao, ItemFicha, Unidade } from '../types'

/**
 * Editor das fichas de medição, para o administrador.
 *
 * O que o chefe de campo precisa mudar sem programador: nome da ficha, quantos
 * dias dura, quais pontos de medição existem, e para cada ponto o rótulo, a
 * unidade, a direção do limite e o valor do limite.
 *
 * Duas regras que a tela garante:
 * - `id` de item nunca é editável: é o que liga a medição já gravada ao ponto
 *   certo. Trocar o id faria o histórico antigo perder a linha.
 * - "Voltar ao padrão" apaga o ajuste e devolve a ficha do código, sem que o
 *   administrador tenha que lembrar como era antes.
 */

const UNIDADES: Unidade[] = ['µΩ', 'MΩ', 'A']

interface Props {
  ajustes: FichasAjustadas
  onSalvar: (ajustes: FichasAjustadas) => Promise<void> | void
}

export default function EditorFichas({ ajustes, onSalvar }: Props) {
  const [abertaId, setAbertaId] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-slate-200 bg-white p-3">
        <p className="text-[11px] leading-relaxed text-slate-600">
          Aqui você ajusta o que é perguntado em campo. A ficha de papel continua
          valendo como referência — o que mudar aqui passa a aparecer na ficha
          nova e no PDF. <strong>Medições já gravadas não mudam.</strong>
        </p>
      </div>

      {FICHAS.map((padrao) => {
        const ajustada = ajustes[padrao.id]
        const aberta = abertaId === padrao.id
        const emVigor = fichaEmVigor(padrao, ajustada)
        return (
          <div key={padrao.id} className="overflow-hidden rounded-xl border-2 border-slate-200 bg-white">
            <button
              onClick={() => setAbertaId(aberta ? null : padrao.id)}
              className="flex w-full items-center gap-2 p-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{emVigor.nomeCurto}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {emVigor.itens.length} ponto(s) de medição
                  {ajustada ? ' · ajustada' : ''}
                </p>
              </div>
              {aberta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {aberta && (
              <EditorFicha
                chave={padrao.id}
                ajustes={ajustes}
                onSalvar={onSalvar}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function EditorFicha({
  chave,
  ajustes,
  onSalvar,
}: {
  chave: string
  ajustes: FichasAjustadas
  onSalvar: (ajustes: FichasAjustadas) => Promise<void> | void
}) {
  const padrao = useMemo(() => getFichaOriginal(chave), [chave])
  const [rascunho, setRascunho] = useState(() => fichaEmVigor(padrao, ajustes[chave]))
  const [salvando, setSalvando] = useState(false)

  const gravar = async (proxima: typeof rascunho) => {
    setRascunho(proxima)
    setSalvando(true)
    // Guarda só o que difere do código: campos iguais não ocupam espaço e
    // continuam acompanhando o padrão se ele mudar.
    const ajuste: Partial<typeof rascunho> = { itens: proxima.itens }
    if (proxima.nome !== padrao.nome) ajuste.nome = proxima.nome
    if (proxima.nomeCurto !== padrao.nomeCurto) ajuste.nomeCurto = proxima.nomeCurto
    if (proxima.dias !== padrao.dias) ajuste.dias = proxima.dias
    await onSalvar({ ...ajustes, [chave]: ajuste })
    setSalvando(false)
  }

  const mudarItem = (indice: number, mudanca: Partial<ItemFicha>) => {
    const itens = rascunho.itens.map((it, i) => (i === indice ? { ...it, ...mudanca } : it))
    void gravar({ ...rascunho, itens })
  }

  const voltarAoPadrao = async () => {
    const proximos = { ...ajustes }
    delete proximos[chave]
    setRascunho(getFichaOriginal(chave))
    await onSalvar(proximos)
  }

  return (
    <div className="border-t-2 border-slate-100 p-3">
      <Campo rotulo="Nome da ficha">
        <input
          value={rascunho.nome}
          onChange={(e) => void gravar({ ...rascunho, nome: e.target.value })}
          className={CAMPO}
        />
      </Campo>
      <Campo rotulo="Nome curto (aparece nas listas)">
        <input
          value={rascunho.nomeCurto}
          onChange={(e) => void gravar({ ...rascunho, nomeCurto: e.target.value })}
          className={CAMPO}
        />
      </Campo>
      <Campo rotulo="Dias de manutenção">
        <input
          type="number"
          min={1}
          value={rascunho.dias ?? 1}
          onChange={(e) => void gravar({ ...rascunho, dias: Number(e.target.value) || 1 })}
          className={CAMPO}
        />
      </Campo>

      <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Pontos de medição
      </p>

      <div className="mt-2 space-y-3">
        {rascunho.itens.map((item, indice) => (
          <div key={item.id} className="rounded-xl border-2 border-slate-200 p-2.5">
            <div className="mb-1 flex items-start gap-2">
              <span className="mt-1.5 text-[11px] font-bold text-slate-400">{indice + 1}</span>
              <input
                value={item.nome}
                onChange={(e) => mudarItem(indice, { nome: e.target.value })}
                className={`${CAMPO} flex-1`}
              />
              <button
                onClick={() => {
                  const itens = rascunho.itens.filter((_, i) => i !== indice)
                  if (itens.length > 0) void gravar({ ...rascunho, itens })
                }}
                disabled={rascunho.itens.length <= 1}
                aria-label="Remover ponto"
                className="mt-1.5 text-slate-400 disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="block">
                <span className="text-[10px] font-semibold text-slate-500">Unidade</span>
                <select
                  value={item.unidade}
                  onChange={(e) => mudarItem(indice, { unidade: e.target.value as Unidade })}
                  className={CAMPO}
                >
                  {UNIDADES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-slate-500">Limite</span>
                <select
                  value={item.direcao}
                  onChange={(e) => mudarItem(indice, { direcao: e.target.value as Direcao })}
                  className={CAMPO}
                >
                  <option value="max">máx.</option>
                  <option value="min">mín.</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-slate-500">Valor</span>
                <input
                  type="number"
                  step="any"
                  value={item.limite}
                  onChange={(e) => mudarItem(indice, { limite: Number(e.target.value) })}
                  className={CAMPO}
                />
              </label>
            </div>

            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={item.aceitaInfinito === true}
                onChange={(e) => mudarItem(indice, { aceitaInfinito: e.target.checked })}
                className="h-4 w-4 accent-blue-700"
              />
              Aceita ∞ (medição de isolação)
            </label>

            <p className="mt-1 text-[10px] text-slate-400">Instrumento: {item.instrumento}</p>
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          const novo: ItemFicha = {
            // Id novo e estável: pontos antigos não são afetados e a medição
            // nova grava em linha própria.
            id: `item-${Date.now().toString(36)}`,
            nome: 'Novo ponto de medição',
            instrumento: rascunho.itens[0]?.instrumento ?? 'Microohmímetro',
            unidade: 'µΩ',
            direcao: 'max',
            limite: 0,
          }
          void gravar({ ...rascunho, itens: [...rascunho.itens, novo] })
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-xs font-semibold text-slate-600"
      >
        <Plus size={15} /> Adicionar ponto
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-400">
          {salvando ? 'Salvando…' : 'Alterações salvas neste aparelho'}
        </p>
        <button
          onClick={() => void voltarAoPadrao()}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600"
        >
          <RotateCcw size={13} /> Voltar ao padrão
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        Campos fixos (patrimônios, RGs) e a lista de núcleos seguem o código: são
        estrutura do app, não parâmetro de ficha.
      </p>
    </div>
  )
}

/** A ficha como está no código, ignorando qualquer ajuste salvo. */
function getFichaOriginal(id: string): DefinicaoFicha {
  return FICHAS.find((f) => f.id === id) ?? FICHAS[0]
}

const CAMPO =
  'mt-0.5 w-full rounded-lg border-2 border-slate-200 bg-white px-2 py-1.5 text-[16px] text-slate-900 outline-none focus:border-blue-600'

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block">
      <span className="text-[11px] font-semibold text-slate-500">{rotulo}</span>
      {children}
    </label>
  )
}
