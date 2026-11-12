import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Info } from 'lucide-react'
import type { DefinicaoFicha, Execucao, Marca, TipoManutencao } from '../types'
import { lerCamposFixos, salvarCamposFixos } from '../lib/db'
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
  const [cabecalho, setCabecalho] = useState<Record<string, string>>(execucao.cabecalho)
  const [camposFixos, setCamposFixos] = useState<Record<string, string>>(execucao.camposFixos)
  const [local, setLocal] = useState(execucao.local)
  const [dataHora, setDataHora] = useState(() => paraInputLocal(execucao.dataHora))
  const [marca, setMarca] = useState<Marca | undefined>(execucao.marca)
  const [tipoManutencao, setTipoManutencao] = useState<TipoManutencao | undefined>(
    execucao.tipoManutencao ?? ficha.tiposManutencao[0],
  )
  const [equipamentoNome, setEquipamentoNome] = useState(execucao.camposFixos.equipamento ?? '')
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])

  // Puxa a memória dos campos fixos do equipamento (torquímetro, séries)
  useEffect(() => {
    void (async () => {
      const memoria = await lerCamposFixos(ficha.id)
      setCamposFixos((atual) => ({ ...memoria, ...atual }))
    })()
  }, [ficha.id])

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

  const salvarCampos = (patch: Partial<Execucao>) => onAtualizar(patch)

  /** RGs marcados na equipe viram os campos fixos rg1..rgN, na ordem do cadastro. */
  const selecionarPessoa = (pessoa: Pessoa) => {
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
    const proximo: Record<string, string> = { ...camposFixos, equipamento: texto }
    if (equipamento) {
      if (equipamento.serie) proximo.serieInstalado = equipamento.serie
      if (equipamento.local) {
        setLocal(equipamento.local)
      }
    }
    setCamposFixos(proximo)
    salvarCampos({
      camposFixos: proximo,
      ...(equipamento?.local ? { local: equipamento.local } : {}),
    })
  }

  const podeContinuar =
    local.trim().length > 0 && (!ficha.exigeMarca || !!marca) && !!tipoManutencao

  const continuar = () => {
    if (!podeContinuar) return
    void salvarCamposFixos(ficha.id, camposFixos)
    salvarCampos({
      cabecalho,
      camposFixos,
      local: local.trim(),
      marca,
      tipoManutencao,
      dataHora: new Date(dataHora).toISOString(),
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
            <span className="mb-1 block text-xs font-medium text-slate-600">Data e hora</span>
            <input
              type="datetime-local"
              value={dataHora}
              onChange={(e) => setDataHora(e.target.value)}
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>
        </section>

        {ficha.camposCabecalho.length > 0 && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Cabeçalho da ficha</h3>
            <div className="grid grid-cols-2 gap-3">
              {ficha.camposCabecalho.map((campo) => (
                <label key={campo.id} className={campo.id === 'ped' ? 'col-span-2' : ''}>
                  <span className="mb-1 block text-xs font-medium text-slate-600">{campo.nome}</span>
                  <input
                    type="text"
                    value={cabecalho[campo.id] ?? ''}
                    onChange={(e) => {
                      const proximo = { ...cabecalho, [campo.id]: e.target.value }
                      setCabecalho(proximo)
                      salvarCampos({ cabecalho: proximo })
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                  />
                </label>
              ))}
            </div>
          </section>
        )}

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
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Equipe</h3>
          </div>
          <SeletorEquipe
            pessoas={pessoas}
            selecionados={extrairRgs(camposFixos)}
            onAlternar={selecionarPessoa}
          />
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Instrumento e série</h3>
          </div>
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">
            <Info size={16} className="mt-0.5 shrink-0" />
            Estes campos não mudam a cada medição — o app guarda o último valor informado.
          </p>
          <div className="space-y-3">
            {camposFixosEditaveis(ficha).map((campo) => (
              <label key={campo.id} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">{campo.nome}</span>
                {campo.tipo === 'lista' ? (
                  <select
                    value={camposFixos[campo.id] ?? ''}
                    onChange={(e) => {
                      const proximo = { ...camposFixos, [campo.id]: e.target.value }
                      setCamposFixos(proximo)
                      salvarCampos({ camposFixos: proximo })
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                  >
                    <option value="">— selecione —</option>
                    {opcoesDaLista(campo.lista, camposFixos[campo.id]).map((opcao) => (
                      <option key={opcao} value={opcao}>
                        {opcao}
                      </option>
                    ))}
                  </select>
                ) : (
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
                )}
              </label>
            ))}
          </div>
        </section>
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
