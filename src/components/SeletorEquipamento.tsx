import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import type { Equipamento } from '../lib/cadastros'
import { filtrarEquipamentos, normalizar } from '../lib/cadastros'

interface Props {
  equipamentos: Equipamento[]
  fichaId: string
  valor: string
  onSelecionar: (equipamento: Equipamento | null, textoLivre: string) => void
}

/**
 * Dropdown pesquisável de equipamentos. Se o técnico digitar algo que não está
 * no cadastro, o texto livre continua valendo — o cadastro é atalho, não corrente.
 */
export default function SeletorEquipamento({ equipamentos, fichaId, valor, onSelecionar }: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  const campoBusca = useRef<HTMLInputElement>(null)

  const lista = useMemo(
    () => filtrarEquipamentos(equipamentos, busca, fichaId),
    [equipamentos, busca, fichaId],
  )

  useEffect(() => {
    if (!aberto) return
    const aoClicarFora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const t = setTimeout(() => campoBusca.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [aberto])

  const semCadastro = lista.length === 0

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => {
          setBusca('')   // limpa ao abrir/fechar, em vez de fazer isso no efeito
          setAberto((v) => !v)
        }}
        className="flex w-full items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-left"
      >
        <span
          className={`min-w-0 flex-1 truncate text-base ${
            valor ? 'text-slate-900' : 'text-slate-400'
          }`}
        >
          {valor || 'Selecionar equipamento'}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border-2 border-blue-600 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              ref={campoBusca}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, local ou série"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {busca && (
              <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca">
                <X size={16} className="text-slate-400" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {lista.map((equip) => {
              const selecionado = normalizar(equip.nome) === normalizar(valor)
              return (
                <button
                  key={equip.id}
                  type="button"
                  onClick={() => {
                    onSelecionar(equip, equip.nome)
                    setAberto(false)
                  }}
                  className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 active:bg-blue-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {equip.nome}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {[equip.local, equip.serie, equip.marca].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {selecionado && <Check size={16} className="mt-0.5 shrink-0 text-blue-700" />}
                </button>
              )
            })}

            {semCadastro && (
              <div className="px-3 py-3">
                <p className="text-xs text-slate-500">
                  Nenhum equipamento encontrado{busca ? ` para "${busca}"` : ''}.
                </p>
                {busca && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelecionar(null, busca)
                      setAberto(false)
                    }}
                    className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700"
                  >
                    Usar "{busca}" como texto livre
                  </button>
                )}
              </div>
            )}

            {valor && (
              <button
                type="button"
                onClick={() => {
                  onSelecionar(null, '')
                  setAberto(false)
                }}
                className="w-full border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-red-700"
              >
                Limpar seleção
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
