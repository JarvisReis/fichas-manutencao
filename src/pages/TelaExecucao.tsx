import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Camera, Check, Infinity as Inf, Plus, Save, Trash2, X } from 'lucide-react'
import type { DefinicaoFicha, Execucao, Foto, Marca, ValorItem } from '../types'
import { avaliarItem } from '../lib/conformidade'
import { comprimirImagem, db } from '../lib/db'

interface Props {
  ficha: DefinicaoFicha
  execucao: Execucao
  /** rascunho é de quem executa; concluída só administrador reabre */
  podeAlterar: boolean
  onVoltar: () => void
  onSalvar: (status: 'rascunho' | 'concluida') => void
  onAtualizar: (patch: Partial<Execucao>) => void
  /** ficha salva em modo leitura: abre uma manutenção nova do mesmo equipamento */
  onNovaManutencao?: () => void
}

/** Marcador da foto única anexada à observação final da execução. */
const ITEM_OBSERVACAO = '__observacao__'

const corResultado = {
  conforme: { card: 'border-emerald-300 bg-emerald-50', badge: 'bg-emerald-600 text-white', texto: 'CONFORME' },
  nao_conforme: { card: 'border-red-300 bg-red-50', badge: 'bg-red-600 text-white', texto: 'FORA DO LIMITE' },
  na: { card: 'border-slate-300 bg-slate-100', badge: 'bg-slate-500 text-white', texto: 'N/A' },
  vazio: { card: 'border-slate-200 bg-white', badge: 'bg-slate-200 text-slate-600', texto: '—' },
} as const

export default function TelaExecucao({
  ficha,
  execucao,
  podeAlterar,
  onVoltar,
  onSalvar,
  onAtualizar,
  onNovaManutencao,
}: Props) {
  const [valores, setValores] = useState<ValorItem[]>(execucao.valores)
  const [obsGeral, setObsGeral] = useState(execucao.observacaoGeral ?? '')
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [carregandoFoto, setCarregandoFoto] = useState<string | null>(null)
  const [fotoObservacaoUrl, setFotoObservacaoUrl] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const marca = execucao.marca

  /*
   * Ordem de preenchimento no teclado. Alguns teclados numéricos de Android
   * (o de campo, com vírgula e sinal) não têm tecla "próximo" — o técnico fica
   * preso no campo. Cada input guarda sua posição e o "Próximo" do teclado leva
   * para o seguinte, na mesma ordem em que os itens aparecem na ficha.
   */
  const camposRef = useRef<(HTMLInputElement | null)[]>([])
  // Observação entra no fim da sequência: o técnico avança das medições direto para ela.
  const obsRef = useRef<HTMLTextAreaElement | null>(null)

  const focarCampo = (posicao: number) => {
    const campos = camposRef.current
    for (let i = posicao; i < campos.length; i++) {
      const alvo = campos[i]
      if (alvo && !alvo.disabled && !alvo.readOnly) {
        alvo.focus()
        alvo.select()
        return
      }
    }
    // Passou da última medição: segue para a observação, se ela for editável.
    const obs = obsRef.current
    if (posicao >= totalMedicoes && obs && !obs.readOnly) {
      obs.focus()
      return
    }
    // Último campo de verdade: fecha o teclado em vez de deixar preso.
    campos[posicao]?.blur()
  }

  // Carrega URLs de preview das fotos já salvas
  useEffect(() => {
    let cancelado = false
    const urls: string[] = []

    ;(async () => {
      const registros = await db.fotos.where('execucaoId').equals(execucao.id).toArray()
      const mapa: Record<string, string> = {}
      for (const f of registros) {
        const url = URL.createObjectURL(f.blob)
        urls.push(url)
        if (f.itemId === ITEM_OBSERVACAO) setFotoObservacaoUrl(url)
        else mapa[f.itemId] = url
      }
      if (!cancelado) setFotos(mapa)
    })()

    return () => {
      cancelado = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [execucao.id])

  const aplicarValores = (proximo: ValorItem[]) => {
    setValores(proximo)
    onAtualizar({ valores: proximo })
  }

  const definirValor = (itemId: string, valor: string) => {
    const existe = valores.some((v) => v.itemId === itemId)
    aplicarValores(
      existe
        ? valores.map((v) => (v.itemId === itemId ? { ...v, valor } : v))
        : [...valores, { itemId, valor }],
    )
  }

  const valorDe = (itemId: string) => valores.find((v) => v.itemId === itemId)?.valor ?? ''

  const tirarFoto = async (itemId: string, arquivo: File | undefined | null) => {
    if (!arquivo) return
    setCarregandoFoto(itemId)
    try {
      const blob = await comprimirImagem(arquivo)

      // Remove foto anterior do mesmo item
      const anteriores = await db.fotos.where('execucaoId').equals(execucao.id).toArray()
      for (const antiga of anteriores.filter((f) => f.itemId === itemId)) {
        await db.fotos.delete(antiga.id)
      }

      const foto: Foto = {
        id: crypto.randomUUID(),
        execucaoId: execucao.id,
        itemId,
        blob,
        criadaEm: new Date().toISOString(),
      }
      await db.fotos.put(foto)

      setFotos((atual) => {
        if (atual[itemId]) URL.revokeObjectURL(atual[itemId])
        return { ...atual, [itemId]: URL.createObjectURL(blob) }
      })

      aplicarValores(valores.map((v) => (v.itemId === itemId ? { ...v, fotoId: foto.id } : v)))
    } catch (erro) {
      setAviso(`Não foi possível processar a foto: ${(erro as Error).message}`)
    } finally {
      setCarregandoFoto(null)
    }
  }

  const removerFoto = async (itemId: string) => {
    const registros = await db.fotos.where('execucaoId').equals(execucao.id).toArray()
    for (const f of registros.filter((r) => r.itemId === itemId)) await db.fotos.delete(f.id)
    setFotos((atual) => {
      const copia = { ...atual }
      if (copia[itemId]) URL.revokeObjectURL(copia[itemId])
      delete copia[itemId]
      return copia
    })
    aplicarValores(valores.map((v) => (v.itemId === itemId ? { ...v, fotoId: undefined } : v)))
  }

  const analises = ficha.itens.map((item) => ({
    item,
    analise: avaliarItem(item, valorDe(item.id), marca),
  }))
  const foraDoLimite = analises.filter((a) => a.analise.resultado === 'nao_conforme')
  const pendentes = analises.filter((a) => a.analise.resultado === 'vazio').length

  // Itens com campo de medição, na ordem da tela. Itens N/A (marca) não contam
  // na sequência do teclado — nenhum campo deles recebe foco.
  const comCampo = analises.filter((a) => a.analise.resultado !== 'na').map((a) => a.item.id)
  const totalMedicoes = comCampo.length

  const tirarFotoObservacao = async (arquivo: File | undefined | null) => {
    if (!arquivo) return
    setCarregandoFoto('observacao')
    try {
      const anteriores = await db.fotos.where('execucaoId').equals(execucao.id).toArray()
      for (const antiga of anteriores.filter((f) => f.itemId === ITEM_OBSERVACAO)) {
        await db.fotos.delete(antiga.id)
      }
      const blob = await comprimirImagem(arquivo)
      const foto: Foto = {
        id: crypto.randomUUID(),
        execucaoId: execucao.id,
        itemId: ITEM_OBSERVACAO,
        blob,
        criadaEm: new Date().toISOString(),
      }
      await db.fotos.put(foto)
      if (fotoObservacaoUrl) URL.revokeObjectURL(fotoObservacaoUrl)
      setFotoObservacaoUrl(URL.createObjectURL(blob))
    } catch (erro) {
      setAviso(`Não foi possível processar a foto: ${(erro as Error).message}`)
    } finally {
      setCarregandoFoto(null)
    }
  }

  const removerFotoObservacao = async () => {
    const registros = await db.fotos.where('execucaoId').equals(execucao.id).toArray()
    for (const f of registros.filter((r) => r.itemId === ITEM_OBSERVACAO)) {
      await db.fotos.delete(f.id)
    }
    if (fotoObservacaoUrl) URL.revokeObjectURL(fotoObservacaoUrl)
    setFotoObservacaoUrl(null)
  }

  const concluir = () => {
    if (!podeAlterar) {
      setAviso('Esta ficha está concluída. Só um administrador pode alterá-la.')
      return
    }
    if (pendentes > 0) {
      setAviso(`Ainda faltam ${pendentes} medição(ões) para preencher.`)
      return
    }
    setAviso(null)
    onSalvar('concluida')
  }

  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={onVoltar}
            className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{ficha.nomeCurto}</p>
            <p className="text-xs text-slate-500">
              {execucao.codigo} · {execucao.local || 'sem local'}
              {marca ? ` · ${marca === 'merlin' ? 'Merlin Gerin' : 'Schneider'}` : ''}
              {execucao.tipoManutencao ? ` · ${execucao.tipoManutencao}` : ''}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {analises.length - pendentes}/{analises.length}
          </span>
        </div>
        {foraDoLimite.length > 0 && (
          <div className="bg-red-600 px-4 py-2 text-xs font-semibold text-white">
            {foraDoLimite.length} item(ns) fora do limite
          </div>
        )}
      </header>

      <div className="space-y-3 p-4">
        {ficha.itens.map((item, indice) => {
          const analise = avaliarItem(item, valorDe(item.id), marca)
          const cores = corResultado[analise.resultado]
          const fotoUrl = fotos[item.id]
          const posicao = comCampo.indexOf(item.id)

          return (
            <section
              key={item.id}
              className={`anim-aparecer rounded-2xl border-2 p-4 shadow-sm ${cores.card}`}
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">Item {indice + 1}</p>
                  <h3 className="text-sm font-semibold leading-tight text-slate-900">{item.nome}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{item.instrumento}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${cores.badge}`}>
                  {cores.texto}
                </span>
              </div>

              <p className="mt-2 mb-2 text-xs font-semibold text-slate-700">
                Procedimento: {analise.limiteExibido}
              </p>

              {analise.resultado === 'na' ? (
                <p className="rounded-xl bg-white/70 p-3 text-sm text-slate-600">
                  Não aplicável a esta marca de equipamento.
                </p>
              ) : (
                <>
                  <div className="flex items-stretch gap-2">
                    <div className="relative flex-1">
                      <input
                        ref={(el) => {
                          if (posicao >= 0) camposRef.current[posicao] = el
                        }}
                        type="text"
                        inputMode="decimal"
                        enterKeyHint={posicao === totalMedicoes - 1 ? 'done' : 'next'}
                        autoComplete="off"
                        value={valorDe(item.id)}
                        onChange={(e) => definirValor(item.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            focarCampo(posicao + 1)
                          }
                        }}
                        readOnly={!podeAlterar}
                        placeholder="0"
                        className="input-medida w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 pr-14 text-slate-900 outline-none focus:border-blue-600"
                      />
                      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-base font-semibold text-slate-500">
                        {item.unidade}
                      </span>
                    </div>
                    {item.aceitaInfinito && (
                      <button
                        onClick={() => definirValor(item.id, '∞')}
                        className="flex w-14 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-slate-700 active:bg-slate-100"
                        aria-label="Valor infinito"
                      >
                        <Inf size={22} />
                      </button>
                    )}
                    {/*
                      Teclado numérico de campo (o de três linhas) não tem tecla de
                      ação — nem "Próximo" nem "Concluído". Esta seta é o avanço:
                      grava o foco no próximo campo, e no último fecha o teclado.
                    */}
                    {podeAlterar && (
                      <button
                        type="button"
                        onClick={() => {
                          if (posicao === totalMedicoes - 1) {
                            camposRef.current[posicao]?.blur()
                          } else {
                            focarCampo(posicao + 1)
                          }
                        }}
                        className="flex w-12 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-slate-600 active:bg-slate-100"
                        aria-label={
                          posicao === totalMedicoes - 1 ? 'Fechar teclado' : 'Próximo campo'
                        }
                      >
                        {posicao === totalMedicoes - 1 ? <Check size={22} /> : <ChevronDown size={22} />}
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 active:scale-[0.99]">
                      <Camera size={16} />
                      {carregandoFoto === item.id
                        ? 'Processando…'
                        : fotoUrl
                          ? 'Trocar foto'
                          : 'Foto (opcional)'}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          void tirarFoto(item.id, e.target.files?.[0])
                          e.currentTarget.value = ''
                        }}
                      />
                    </label>
                    {fotoUrl && (
                      <button
                        onClick={() => void removerFoto(item.id)}
                        className="rounded-xl border-2 border-slate-300 bg-white p-2.5 text-slate-600"
                        aria-label="Remover foto"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  {fotoUrl && (
                    <img
                      src={fotoUrl}
                      alt={`Foto do item ${item.nome}`}
                      className="mt-2 h-32 w-full rounded-xl border border-slate-200 object-cover"
                    />
                  )}
                </>
              )}
            </section>
          )
        })}

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Observação</h3>
          <textarea
            ref={obsRef}
            value={obsGeral}
            readOnly={!podeAlterar}
            onChange={(e) => {
              if (!podeAlterar) return
              setObsGeral(e.target.value)
              onAtualizar({ observacaoGeral: e.target.value })
            }}
            rows={4}
            placeholder="Anotações da execução (opcional)…"
            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600"
          />

          <div className="mt-3">
            {fotoObservacaoUrl ? (
              <div className="relative">
                <img
                  src={fotoObservacaoUrl}
                  alt="Foto da observação"
                  className="h-40 w-full rounded-xl border border-slate-200 object-cover"
                />
                <div className="mt-2 flex gap-2">
                  <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 active:scale-[0.99]">
                    <Camera size={16} />
                    {carregandoFoto === 'observacao' ? 'Processando…' : 'Trocar foto'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        void tirarFotoObservacao(e.target.files?.[0])
                        e.currentTarget.value = ''
                      }}
                    />
                  </label>
                  <button
                    onClick={() => void removerFotoObservacao()}
                    className="rounded-xl border-2 border-red-300 px-3 py-2.5 text-red-700 active:bg-red-50"
                    aria-label="Remover foto da observação"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-xs font-semibold text-slate-600 active:scale-[0.99]">
                <Camera size={16} />
                {carregandoFoto === 'observacao' ? 'Processando…' : 'Adicionar foto (opcional)'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void tirarFotoObservacao(e.target.files?.[0])
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            )}
          </div>
        </section>
      </div>

      {aviso && (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-4 flex items-start gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          <X size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{aviso}</span>
          <button onClick={() => setAviso(null)} className="font-bold">
            ok
          </button>
        </div>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        {!podeAlterar ? (
          <div className="space-y-2">
            <p className="rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-semibold text-slate-600">
              Ficha concluída — somente leitura.
            </p>
            {onNovaManutencao && (
              <button
                onClick={onNovaManutencao}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white active:bg-blue-800"
              >
                <Plus size={18} /> Nova manutenção deste equipamento
              </button>
            )}
          </div>
        ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onSalvar('rascunho')}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700 active:bg-slate-100"
          >
            <Save size={18} /> Rascunho
          </button>
          <button
            onClick={concluir}
            className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white active:bg-blue-800"
          >
            <Check size={18} /> Concluir
          </button>
        </div>
        )}
      </footer>
    </div>
  )
}

export type { Marca }
