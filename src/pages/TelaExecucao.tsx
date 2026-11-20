import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Check, FileDown, Infinity as Inf, Plus, Save, X } from 'lucide-react'
import { NOME_MARCA, type DefinicaoFicha, type Execucao, type Marca, type ValorItem } from '../types'
import { avaliarItem } from '../lib/conformidade'
import { avisoDeRevisao, revisaoDeLimite } from '../lib/limiteRevogado'
import { lerPessoas } from '../lib/cadastros'
async function baixarPdfRelatorio(args: Parameters<typeof import('../lib/pdfRelatorio')['baixarPdfRelatorio']>[0]) {
  const mod = await import('../lib/pdfRelatorio')
  return mod.baixarPdfRelatorio(args)
}
import {
  estaEmModoRelatorio,
  tipoEmVigor,
  topicosDaFicha,
  type Topico,
} from '../lib/topicosFicha'

interface Props {
  ficha: DefinicaoFicha
  execucao: Execucao
  /** rascunho é de quem executa; concluída só administrador reabre */
  podeAlterar: boolean
  onVoltar: () => void
  /**
   * Leva para a aba de outro bloco que não vive nesta tela.
   *
   * Medições é a única aba desenhada aqui. Equipe, Núcleo e Instrumentos são
   * blocos da tela de identificação, então a aba daqui precisa navegar até lá
   * em vez de trocar o tópico local — trocar deixava a tela em branco.
   */
  onIrParaTopico?: (topico: Topico) => void
  onSalvar: (status: 'rascunho' | 'concluida' | 'pendente') => void
  onAtualizar: (patch: Partial<Execucao>) => void
  /** ficha salva em modo leitura: abre uma manutenção nova do mesmo equipamento */
  onNovaManutencao?: () => void
  /** sem pessoa identificada: o app só visualiza, não grava */
  semIdentificacao?: boolean
  /**
   * Abre o editor da ficha (parâmetros: nome, limites, pontos de medição).
   * Só administrador recebe isto — o técnico não muda o que vai medir.
   */
}

/** Patrimônios dos instrumentos guardados nos campos fixos da execução. */
const INSTRUMENTOS: [string, string][] = [
  ['microPatrimonio', 'Microohmímetro'],
  ['megaPatrimonio', 'Megômetro'],
  ['torqPatrimonio', 'Torquímetro'],
]

/** Data e hora em pt-BR, curto o bastante para caber no cabeçalho da ficha. */
function formatarDataHora(iso: string | undefined): string {
  if (!iso) return '—'
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return '—'
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}


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
  onIrParaTopico,
  onSalvar,
  onAtualizar,
  onNovaManutencao,
  semIdentificacao = false,
}: Props) {
  const [valores, setValores] = useState<ValorItem[]>(execucao.valores)
  const [obsGeral, setObsGeral] = useState(execucao.observacaoGeral ?? '')
  const [aviso, setAviso] = useState<string | null>(null)
  const [nomePorRg, setNomePorRg] = useState<Record<string, string>>({})

  const marca = execucao.marca

  // A equipe é gravada por RG; o nome vem do cadastro só para exibir a ficha.
  useEffect(() => {
    void (async () => {
      const pessoas = await lerPessoas()
      const mapa: Record<string, string> = {}
      for (const p of pessoas) mapa[p.rg.trim()] = p.nome
      setNomePorRg(mapa)
    })()
  }, [])

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

  const aplicarValores = (proximo: ValorItem[]) => {
    setValores(proximo)
    onAtualizar({ valores: proximo })
  }

  const definirValor = (itemId: string, valor: string) => {
    const existe = valores.some((v) => v.itemId === itemId)
    /**
     * Grava junto o limite em vigor no instante da medição.
     *
     * Sem esse retrato, uma revisão posterior do limite faria a medição antiga
     * parecer conforme por uma régua que já não vale — e não haveria como
     * descobrir isso depois. O retrato é do que valia então, não do que vale
     * agora: é justamente o que permite acusar a diferença.
     */
    const item = ficha.itens.find((i) => i.id === itemId)
    const retrato: Partial<ValorItem> = item
      ? {
          limiteUsado: Number.isFinite(item.limite) ? item.limite : undefined,
          direcaoUsada: item.direcao,
          unidadeUsada: item.unidade,
        }
      : {}
    aplicarValores(
      existe
        ? valores.map((v) => (v.itemId === itemId ? { ...v, valor, ...retrato } : v))
        : [...valores, { itemId, valor, ...retrato }],
    )
  }

  const valorDe = (itemId: string) => valores.find((v) => v.itemId === itemId)?.valor ?? ''

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

  // Dados de identificação exibidos na ficha salva: equipe e instrumentos.
  const equipe = [1, 2, 3, 4, 5, 6]
    .map((i) => (execucao.camposFixos[`rg${i}`] ?? '').trim())
    .filter((rg) => rg.length > 0)
    .map((rg) => ({ rg, nome: nomePorRg[rg] }))

  const instrumentos = INSTRUMENTOS.filter(([campo]) =>
    Boolean((execucao.camposFixos[campo] ?? '').trim()),
  ).map(([campo, nome]) => [nome, execucao.camposFixos[campo]] as const)

  /**
   * Tópicos são ferramenta de **preenchimento** — valem igual para ficha nova e
   * para ficha reaberta. Ficha concluída é documento: sai numa tela só, de cima
   * a baixo, como o papel assinado, e nada nela se altera.
   */
  const topicos = topicosDaFicha({ ficha })
  const [topico, setTopico] = useState<Topico | null>(null)
  const topicoAtivo = tipoEmVigor(topicos, topico)
  const modoRelatorio = estaEmModoRelatorio(podeAlterar)

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
    // Medição fora de faixa não impede salvar: em campo o técnico não pode
    // ficar travado por um valor ruim. A ficha é salva e marcada como pendente.
    onSalvar(foraDoLimite.length > 0 ? 'pendente' : 'concluida')
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
              {marca ? ` · ${NOME_MARCA[marca]}` : ''}
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

        {/* Tópicos: um bloco por vez, como a ficha de papel. Só no preenchimento —
            a ficha concluída é relatório e aparece inteira. */}
        {!modoRelatorio && (
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {topicos.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                /**
                 * Fora das medições, esta tela só **mostra** — é relatório.
                 *
                 * Quando a ficha é editável (rascunho, ou correção de admin) e
                 * existe para onde ir, a aba leva à tela de identificação, que
                 * é onde os campos desses blocos se editam. Sem isso, "corrigir"
                 * abria abas que só davam para ler.
                 */
                if (t.id !== 'medicoes' && onIrParaTopico && !modoRelatorio) {
                  onIrParaTopico(t.id)
                  return
                }
                setTopico(t.id)
              }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                topicoAtivo === t.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 active:bg-slate-200'
              }`}
            >
              {t.rotulo}
              {t.id === 'medicoes' && (
                <span className="ml-1 font-normal opacity-70">
                  {analises.length - pendentes}/{analises.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        )}
      </header>

      <div className="space-y-3 p-4">
        {/* Cabeçalho da manutenção: em ficha salva o técnico precisa ver de quem
            é o equipamento e o que foi usado, não só os números medidos. */}
        {(modoRelatorio || topicoAtivo === 'identificacao') && (
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Identificação</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            {[
              ['Equipamento', execucao.camposFixos.equipamento || '—'],
              ['Local', execucao.local || '—'],
              ['Ficha', ficha.nomeCurto],
              ['Tipo', execucao.tipoManutencao || '—'],
              ...(marca ? [[`Marca`, NOME_MARCA[marca]]] : []),
              ['Início', formatarDataHora(execucao.dataHora)],
              ...(execucao.dataFim && execucao.dataFim !== execucao.dataHora
                ? [['Encerramento', formatarDataHora(execucao.dataFim)]]
                : []),
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="min-w-0">
                <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                  {rotulo}
                </dt>
                <dd className="truncate text-sm font-medium text-slate-900">{valor}</dd>
              </div>
            ))}
          </dl>

        </section>
        )}

        {(modoRelatorio || topicoAtivo === 'equipe') && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Equipe</h3>
            <div className="flex flex-wrap gap-1.5">
              {equipe.length === 0 && <span className="text-sm text-slate-500">—</span>}
              {equipe.map((pessoa, i) => (
                <span
                  key={`${pessoa.rg}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-800"
                >
                  {pessoa.nome ?? '—'}
                  <span className="rounded bg-white px-1 font-mono text-[10px] font-bold">
                    RG {pessoa.rg}
                  </span>
                </span>
              ))}
            </div>
          </section>
        )}

        {(modoRelatorio || topicoAtivo === 'nucleo') && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Núcleo</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
              {[
                ['Núcleo instalado', execucao.nucleoInstalado || '—'],
                ['Núcleo retirado', execucao.camposFixos.serieRetirado || '—'],
                /**
                 * "Tipo de manutenção" saiu daqui: já aparece na Identificação,
                 * e nesta ficha vinha em branco (o campo do cartão lia um dado
                 * que só existia no cabeçalho), o que dava a impressão de
                 * ficha incompleta.
                 */
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0">
                  <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    {rotulo}
                  </dt>
                  <dd className="truncate font-mono text-sm font-medium text-slate-900">{valor}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {(modoRelatorio || topicoAtivo === 'instrumentos') && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Instrumentos</h3>
            <ul className="space-y-1 text-sm text-slate-800">
              {instrumentos.map(([nome, patrimonio]) => (
                <li key={nome}>
                  {nome}{' '}
                  <span className="font-mono text-xs font-semibold text-slate-600">
                    {patrimonio}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(modoRelatorio || topicoAtivo === 'medicoes') && ficha.itens.map((item, indice) => {
          const analise = avaliarItem(item, valorDe(item.id), marca)
          const cores = corResultado[analise.resultado]
          const posicao = comCampo.indexOf(item.id)
          const revisao = revisaoDeLimite(
            valores.find((v) => v.itemId === item.id),
            item,
          )

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

              {revisao.revogado && (
                <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-amber-900">
                  {avisoDeRevisao(revisao, item.unidade)}
                </p>
              )}

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
                </>
              )}
            </section>
          )
        })}

        {(modoRelatorio || topicoAtivo === 'medicoes') && (
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
        </section>
        )}
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
              {semIdentificacao
                ? 'Sem identificação — só visualização. Toque em entrar no cabeçalho para executar.'
                : 'Ficha concluída — somente leitura.'}
            </p>
            {onNovaManutencao && (
              <button
                onClick={onNovaManutencao}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white active:bg-blue-800"
              >
                <Plus size={18} /> Nova manutenção deste equipamento
              </button>
            )}
            <button
              onClick={() => void baixarPdfRelatorio({ ficha, execucao, nomes: nomePorRg })}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700 active:bg-slate-100"
            >
              <FileDown size={18} /> Baixar relatório em PDF
            </button>
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
            <Check size={18} /> {foraDoLimite.length > 0 ? 'Salvar como pendente' : 'Concluir'}
          </button>
        </div>
        )}
      </footer>
    </div>
  )
}

export type { Marca }
