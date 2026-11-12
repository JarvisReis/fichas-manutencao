import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Info } from 'lucide-react'
import type { DefinicaoFicha, Execucao, Marca, TipoManutencao } from '../types'
import {
  gerarCodigo,
  lerCamposFixos,
  lerEndpointSync,
  lerNucleoInstalado,
  salvarCamposFixos,
} from '../lib/db'
import { lerNucleoDoServidor } from '../lib/sync'
import {
  lerEquipamentos,
  lerPessoas,
  type Equipamento,
  type Pessoa,
} from '../lib/cadastros'
import { NUCLEOS_HPB } from '../config/nucleos'
import SeletorEquipamento from '../components/SeletorEquipamento'
import SeletorEquipe from '../components/SeletorEquipe'

interface Props {
  ficha: DefinicaoFicha
  execucao: Execucao
  onVoltar: () => void
  onAtualizar: (patch: Partial<Execucao>) => void
  onContinuar: () => void
}

export default function TelaIdentificacao({ ficha, execucao, onVoltar, onAtualizar, onContinuar }: Props) {
  const [camposFixos, setCamposFixos] = useState<Record<string, string>>(execucao.camposFixos)
  const [local, setLocal] = useState(execucao.local)
  const [dataHora, setDataHora] = useState(() => paraInputLocal(execucao.dataHora))
  // Manutenção de vários dias (contator = 2): o app já sugere o encerramento
  // em dias-1, mas o técnico ajusta se a parada escorregar.
  const dias = ficha.dias ?? 1
  const [dataFim, setDataFim] = useState(() =>
    paraInputLocal(execucao.dataFim ?? somarDias(execucao.dataHora, dias - 1)),
  )
  const [marca, setMarca] = useState<Marca | undefined>(execucao.marca)
  const [tipoManutencao, setTipoManutencao] = useState<TipoManutencao | undefined>(
    execucao.tipoManutencao ?? ficha.tiposManutencao[0],
  )
  const [equipamentoNome, setEquipamentoNome] = useState(execucao.camposFixos.equipamento ?? '')
  const [nucleoInstalado, setNucleoInstalado] = useState(execucao.nucleoInstalado ?? '')
  const [nucleoRetirado, setNucleoRetirado] = useState(
    execucao.tipoManutencao === 'P2' ? (execucao.camposFixos.serieRetirado ?? '') : '',
  )
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [avisoEquipe, setAvisoEquipe] = useState<string | null>(null)

  // Puxa a memória dos campos fixos do equipamento (torquímetro, RGs)
  useEffect(() => {
    void (async () => {
      const memoria = await lerCamposFixos(ficha.id)
      setCamposFixos((atual) => ({ ...memoria, ...atual }))
    })()
  }, [ficha.id])

  // Núcleo instalado: vem da última manutenção do equipamento e só muda na P2.
  // Na P1 o campo fica somente leitura; na P2 é editável (troca de núcleo).
  useEffect(() => {
    const equipamento = (execucao.camposFixos.equipamento ?? '').trim()
    if (!equipamento || execucao.nucleoInstalado) return
    let cancelado = false
    void (async () => {
      // 1) fonte da verdade: lista Contatores no SharePoint (via proxy)
      const endpoint = lerEndpointSync()
      if (endpoint) {
        const doServidor = await lerNucleoDoServidor(endpoint, equipamento)
        if (cancelado) return
        if (doServidor) {
          setNucleoInstalado(doServidor)
          onAtualizar({ nucleoInstalado: doServidor })
          return
        }
      }
      // 2) sem servidor: última execução registrada neste aparelho
      const anterior = await lerNucleoInstalado(equipamento, {
        id: execucao.id,
        equipamento,
        nucleoInstalado: execucao.nucleoInstalado,
        atualizadaEm: execucao.atualizadaEm,
      })
      if (cancelado || !anterior) return
      setNucleoInstalado(anterior)
      onAtualizar({ nucleoInstalado: anterior })
    })()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega quando o equipamento muda
  }, [execucao.camposFixos.equipamento, execucao.nucleoInstalado])

  // Cadastros: relidos ao abrir a tela e sempre que o app volta ao primeiro plano,
  // porque podem ter sido editados na tela de cadastros.
  useEffect(() => {
    const carregar = async () => {
      const [equips, listaPessoas] = await Promise.all([lerEquipamentos(), lerPessoas()])
      setEquipamentos(equips)
      setPessoas(listaPessoas)
    }
    void carregar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [])

  const ehP2 = tipoManutencao === 'P2'

  const salvarCampos = (patch: Partial<Execucao>) =>
    onAtualizar({
      ...patch,
      nucleoInstalado: patch.nucleoInstalado ?? nucleoInstalado,
    })

  /** RGs marcados na equipe viram os campos fixos rg1..rgN, na ordem do cadastro. */
  const selecionarPessoa = (pessoa: Pessoa) => {
    // A pessoa escolhida pode vir do cadastro ainda sem RG preenchido; sem
    // identidade não dá para gravar a equipe e o botão nunca libera.
    if (!pessoa.rg || !pessoa.rg.trim()) {
      setAvisoEquipe('Esta pessoa está sem RG no cadastro. Peça a um administrador para preencher.')
      return
    }
    setAvisoEquipe(null)
    const atuais = extrairRgs(camposFixos)
    const jaEsta = atuais.some((rg) => rg.trim() === pessoa.rg.trim())
    const proximos = jaEsta
      ? atuais.filter((rg) => rg.trim() !== pessoa.rg.trim())
      : [...atuais, pessoa.rg]

    const proximoMapa = { ...camposFixos }
    for (let i = 1; i <= 6; i++) {
      const valor = proximos[i - 1] ?? ''
      if (valor) proximoMapa[`rg${i}`] = valor
      else delete proximoMapa[`rg${i}`]
    }
    setCamposFixos(proximoMapa)
    salvarCampos({ camposFixos: proximoMapa })
  }

  const selecionarEquipamento = (equipamento: Equipamento | null, texto: string) => {
    setEquipamentoNome(texto)
    // O núcleo instalado não vem do cadastro do equipamento: é lido da última
    // manutenção daquele contator e só é alterado na P2.
    const proximo: Record<string, string> = { ...camposFixos, equipamento: texto }
    if (equipamento?.local) {
      setLocal(equipamento.local)
    }
    setCamposFixos(proximo)
    salvarCampos({
      camposFixos: proximo,
      ...(equipamento?.local ? { local: equipamento.local } : {}),
    })
  }

  // Equipe é obrigatória no mínimo com 2 pessoas: a ficha é preenchida em dupla
  // e o registro precisa identificar quem mediu e quem acompanhou.
  const equipe = extrairRgs(camposFixos)
  const equipeCompleta = equipe.length >= 2
  const podeContinuar =
    local.trim().length > 0 && (!ficha.exigeMarca || !!marca) && !!tipoManutencao && equipeCompleta

  const continuar = () => {
    if (!podeContinuar) return
    // O núcleo retirado só existe na P2; na P1 o campo é descartado.
    const fixosSaida: Record<string, string> = { ...camposFixos }
    if (ehP2 && nucleoRetirado) fixosSaida.serieRetirado = nucleoRetirado
    else delete fixosSaida.serieRetirado

    void salvarCamposFixos(ficha.id, fixosSaida)
    const inicio = new Date(dataHora)
    const fim = dias > 1 ? new Date(dataFim) : inicio
    onAtualizar({
      camposFixos: fixosSaida,
      local: local.trim(),
      marca,
      tipoManutencao,
      nucleoInstalado,
      dataHora: inicio.toISOString(),
      dataFim: dias > 1 ? fim.toISOString() : undefined,
      codigo: gerarCodigo(
        equipamentoNome,
        inicio,
        undefined,
        dias > 1 ? fim.toISOString() : undefined,
      ),
    })
    onContinuar()
  }

  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={onVoltar} className="rounded-xl p-2 text-slate-600 active:bg-slate-100" aria-label="Voltar">
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">Identificação</p>
            <p className="text-xs text-slate-500">
              {ficha.nomeCurto} · {execucao.codigo}
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Equipamento</h3>
          <p className="mb-3 text-xs text-slate-500">
            Busque na lista; se não estiver cadastrado, digite o nome.
          </p>
          <SeletorEquipamento
            equipamentos={equipamentos}
            fichaId={ficha.id}
            valor={equipamentoNome}
            onSelecionar={selecionarEquipamento}
          />
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Tipo de manutenção</h3>
          {ficha.tiposManutencao.length > 1 ? (
            <div className="grid grid-cols-2 gap-2">
              {ficha.tiposManutencao.map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => {
                    setTipoManutencao(tipo)
                    salvarCampos({ tipoManutencao: tipo })
                  }}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition ${
                    tipoManutencao === tipo
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {tipo}
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700">
              {ficha.tiposManutencao[0]} — única manutenção prevista para este equipamento
            </p>
          )}
        </section>
        {ficha.exigeMarca && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Marca do equipamento</h3>
            <p className="mb-3 text-xs text-slate-500">
              O limite de alguns itens muda conforme o fabricante.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { valor: 'merlin' as Marca, rotulo: 'Merlin Gerin' },
                  { valor: 'schneider' as Marca, rotulo: 'Schneider' },
                ] as const
              ).map((opcao) => (
                <button
                  key={opcao.valor}
                  onClick={() => {
                    setMarca(opcao.valor)
                    salvarCampos({ marca: opcao.valor })
                  }}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition ${
                    marca === opcao.valor
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {opcao.rotulo}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Dados da execução</h3>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Local *</span>
            <input
              type="text"
              value={local}
              onChange={(e) => {
                setLocal(e.target.value)
                salvarCampos({ local: e.target.value })
              }}
              placeholder="Ex.: Linha 2 — CD1"
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              {dias > 1 ? 'Início' : 'Data e hora'}
            </span>
            <input
              type="datetime-local"
              value={dataHora}
              onChange={(e) => {
                setDataHora(e.target.value)
                // mantém o encerramento coerente com o novo início
                if (dias > 1) setDataFim(somarDias(new Date(e.target.value).toISOString(), dias - 1))
              }}
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>

          {dias > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Encerramento</span>
              <input
                type="datetime-local"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
              />
              <span className="mt-1.5 flex items-start gap-2 rounded-xl bg-blue-50 p-2.5 text-[11px] text-blue-900">
                <Info size={14} className="mt-0.5 shrink-0" />
                Esta manutenção dura {dias} dias e fecha uma ficha só — a identificação fica com o
                intervalo de datas.
              </span>
            </label>
          )}
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Equipe *</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                equipeCompleta ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {equipe.length}/2 pessoas
            </span>
          </div>
          <SeletorEquipe
            pessoas={pessoas}
            selecionados={equipe}
            onAlternar={selecionarPessoa}
          />
          {avisoEquipe && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] font-medium text-amber-900">
              {avisoEquipe}
            </p>
          )}
          {!equipeCompleta && (
            <p className="mt-2 text-[11px] font-medium text-amber-800">
              Marque no mínimo 2 pessoas da equipe para iniciar as medições.
            </p>
          )}
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Instrumento</h3>
          </div>
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">
            <Info size={16} className="mt-0.5 shrink-0" />
            Estes campos não mudam a cada medição — o app guarda o último valor informado.
          </p>
          <div className="space-y-3">
            {camposFixosEditaveis(ficha)
              .filter((campo) => campo.tipo !== 'lista')
              .map((campo) => (
                <label key={campo.id} className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">{campo.nome}</span>
                  <input
                    type={campo.tipo === 'numero' ? 'number' : 'text'}
                    value={camposFixos[campo.id] ?? ''}
                    onChange={(e) => {
                      const proximo = { ...camposFixos, [campo.id]: e.target.value }
                      setCamposFixos(proximo)
                      salvarCampos({ camposFixos: proximo })
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                  />
                </label>
              ))}
          </div>
        </section>

        {camposFixosEditaveis(ficha).some((campo) => campo.tipo === 'lista') && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Núcleo do contator</h3>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {ehP2
                ? 'Na P2 informe o núcleo que sai e o que entra no contator.'
                : 'Núcleo informado na última manutenção deste contator. Só é alterado na P2.'}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Nº Série do Núcleo — Instalado
                </span>
                <select
                  value={nucleoInstalado}
                  disabled={!ehP2}
                  onChange={(e) => {
                    setNucleoInstalado(e.target.value)
                    salvarCampos({ nucleoInstalado: e.target.value })
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="">— selecione —</option>
                  {opcoesDaLista('nucleos', nucleoInstalado).map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {opcao}
                    </option>
                  ))}
                </select>
                {!ehP2 && (
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {nucleoInstalado
                      ? `Registrado na última manutenção · somente leitura`
                      : 'Sem núcleo registrado para este contator'}
                  </span>
                )}
              </label>

              {ehP2 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Nº Série do Núcleo — Retirado
                  </span>
                  <select
                    value={nucleoRetirado}
                    onChange={(e) => setNucleoRetirado(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                  >
                    <option value="">— selecione —</option>
                    {opcoesDaLista('nucleos', nucleoRetirado).map((opcao) => (
                      <option key={opcao} value={opcao}>
                        {opcao}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <button
          onClick={continuar}
          disabled={!podeContinuar}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3.5 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
        >
          Iniciar medições <ArrowRight size={18} />
        </button>
      </footer>
    </div>
  )
}

/** RGs já registrados nos campos fixos, na ordem rg1..rg6. */
function extrairRgs(camposFixos: Record<string, string>): string[] {
  return [1, 2, 3, 4, 5, 6]
    .map((i) => camposFixos[`rg${i}`] ?? '')
    .filter((rg) => rg.trim().length > 0)
}

/**
 * Opções de um campo tipo 'lista'. Um valor antigo já gravado que não esteja na
 * lista é preservado como primeira opção, para não perder dado de execuções
 * anteriores ao select.
 */
function opcoesDaLista(lista: 'nucleos' | undefined, valorAtual?: string): string[] {
  const base = lista === 'nucleos' ? NUCLEOS_HPB : []
  const atual = (valorAtual ?? '').trim()
  if (atual && !base.includes(atual)) return [atual, ...base]
  return base
}

/** Campos fixos que continuam editáveis (RGs saíram para o seletor de equipe). */
function camposFixosEditaveis(ficha: DefinicaoFicha) {
  return ficha.camposFixos.filter((campo) => !/^rg\d+$/.test(campo.id))
}

function paraInputLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** Mesmo horário, `n` dias depois — em ISO. */
function somarDias(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}
