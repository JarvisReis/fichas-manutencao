import { useMemo, useState } from 'react'
import { Check, Search, Users, X } from 'lucide-react'
import type { Pessoa } from '../lib/cadastros'
import { filtrarPessoas, normalizar, pessoaSelecionavel } from '../lib/cadastros'

interface Props {
  pessoas: Pessoa[]
  selecionados: string[]
  onAlternar: (pessoa: Pessoa) => void
  /**
   * Remove um RG direto da lista, sem passar pelo cadastro. Necessário porque
   * um RG pode estar gravado na execução e não corresponder a ninguém: o
   * técnico corrigiu o RG no cadastro, ou a pessoa foi excluída. Nesse caso o
   * chip aparece como "—" e o botão de remover ficava morto, sem saída na
   * tela.
   */
  onRemoverRg?: (rg: string) => void
}

/** Equipe da execução: marcação múltipla com busca, sem limite de quantidade. */
export default function SeletorEquipe({ pessoas, selecionados, onAlternar, onRemoverRg }: Props) {
  const [busca, setBusca] = useState('')

  const lista = useMemo(() => filtrarPessoas(pessoas, busca), [pessoas, busca])
  // Ativos é o universo que a seleção considera; ocultos alimenta o aviso de
  // que existe gente cadastrada fora da lista (inativa) — senão o técnico
  // procura e não encontra, sem nenhuma explicação na tela. Registro sem nome
  // ou com órgão emissor no lugar do RG não conta como oculto: não é gente.
  const ativos = pessoas.filter(pessoaSelecionavel)
  const ocultos = pessoas.filter((p) => p.ativo === false).length

  const estaSelecionado = (pessoa: Pessoa) => selecionados.some((rg) => normalizar(rg) === normalizar(pessoa.rg))

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou RG"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        {busca && (
          <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca">
            <X size={16} className="text-slate-400" />
          </button>
        )}
      </div>

      {selecionados.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            Equipe desta execução · {selecionados.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selecionados.map((rg) => {
              const pessoa = pessoas.find((p) => normalizar(p.rg) === normalizar(rg))
              // Sem pessoa no cadastro o RG é órfão: sobrou de um cadastro
              // corrigido ou excluído. Não dá para removê-lo "alternando" a
              // pessoa, porque ela não existe — daí o caminho próprio.
              const orfao = !pessoa
              const remover = () => {
                if (pessoa) onAlternar(pessoa)
                else onRemoverRg?.(rg)
              }
              return (
                <span
                  key={rg}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    orfao ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'
                  }`}
                  title={orfao ? 'Este RG não corresponde a ninguém no cadastro' : undefined}
                >
                  <span className="max-w-[9rem] truncate">
                    {pessoa?.nome ?? 'Fora do cadastro'}
                  </span>
                  <span className="rounded bg-white/70 px-1 font-mono text-[10px] font-bold">
                    RG {rg}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remover ${pessoa?.nome ?? `RG ${rg}`}`}
                    onClick={remover}
                  >
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
          <Users size={16} className="shrink-0" />
          {pessoas.length === 0
            ? 'Nenhuma pessoa cadastrada ainda. Cadastre em "Equipe e equipamentos".'
            : ativos.length === 0
              ? 'Nenhum funcionário ativo. Reative alguém em "Equipe e equipamentos".'
              : `Ninguém encontrado para "${busca}".`}
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {lista.map((pessoa) => {
            const ativo = estaSelecionado(pessoa)
            return (
              <button
                key={pessoa.id}
                type="button"
                onClick={() => onAlternar(pessoa)}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                  ativo ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${
                    ativo ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {ativo && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {pessoa.nome}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    RG {pessoa.rg}
                    {pessoa.funcao ? ` · ${pessoa.funcao}` : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* O cadastro novo fica no aparelho e sobe para o servidor na publicação.
          Se o celular do técnico ainda não puxou a versão publicada, a pessoa
          existe mas não aparece — e antes isso virava "não deixa selecionar"
          sem explicação nenhuma. */}
      {ocultos > 0 && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
          {ocultos === 1
            ? '1 funcionário cadastrado está inativo e não aparece aqui.'
            : `${ocultos} funcionários cadastrados estão inativos e não aparecem aqui.`}{' '}
          Reative em "Equipe e equipamentos".
        </p>
      )}
    </div>
  )
}
