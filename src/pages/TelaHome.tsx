import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, Clock, CloudOff, Database, HardDriveDownload, Menu, Moon, Search, Sun, Users, Wifi, X } from 'lucide-react'
import { db } from '../lib/db'
import { FICHAS, GRUPOS, grupoDaFicha } from '../config/fichas'
import { lerEquipamentos, normalizar, type Equipamento } from '../lib/cadastros'
import type { Sessao } from '../lib/sessao'
import type { Execucao } from '../types'
import SeletorSessao from '../components/SeletorSessao'

interface Props {
  sessao: Sessao | null
  onEntrar: (sessao: Sessao) => void
  onSair: () => void
  ehAdministrador: boolean
  /** Abre a execução já com a ficha definida pelo cadastro do contator. */
  onNovaExecucaoDoEquipamento: (equipamento: Equipamento) => void
  onAbrirExecucao: (id: string) => void
  onVerHistorico: () => void
  onVerBackup: () => void
  onVerCadastros: () => void
  onAlternarTema: () => void
  temaEscuro: boolean
  online: boolean
}

/** Aba escolhida na home, lembrada entre visitas. */
const CHAVE_GRUPO = 'fichas:grupo'

export default function TelaHome({
  sessao,
  onEntrar,
  onSair,
  ehAdministrador,
  onNovaExecucaoDoEquipamento,
  onAbrirExecucao,
  onVerHistorico,
  onVerBackup,
  onVerCadastros,
  onAlternarTema,
  temaEscuro,
  online,
}: Props) {
  const pendentes = useLiveQuery(() => db.execucoes.filter((e) => !e.sincronizada).toArray(), [], [])
  // "Continuar" é só o trabalho em andamento: rascunho. Ficha concluída ou
  // pendente é registro fechado e não se continua — fica no cartão do
  // equipamento e no histórico.
  const ultimas = useLiveQuery(
    () =>
      db.execucoes
        .where('status')
        .equals('rascunho')
        .reverse()
        .sortBy('atualizadaEm')
        .then((lista) => lista.slice(0, 3)),
    [],
    [],
  )

  const naoSincronizadas = pendentes?.length ?? 0

  /**
   * Última manutenção encerrada de cada equipamento. O cartão mostra uma só —
   * o histórico completo fica no histórico, para a lista não crescer demais.
   * Rascunho não entra: rascunho é a seção "Continuar".
   */
  const todas = useLiveQuery(() => db.execucoes.toArray(), [], [])
  const ultimaPorEquipamento = useMemo(() => {
    const mapa = new Map<string, (typeof todas)[number]>()
    for (const exec of [...(todas ?? [])]
      .filter((e) => e.status !== 'rascunho')
      .sort((a, b) => Date.parse(b.dataHora) - Date.parse(a.dataHora))) {
      const nome = exec.camposFixos.equipamento?.trim()
      if (nome && !mapa.has(nome)) mapa.set(nome, exec)
    }
    return mapa
  }, [todas])

  /**
   * Os três equipamentos com manutenção mais antiga — os que estão devendo
   * serviço. É a leitura inversa do topo da lista: o que está há mais tempo sem
   * atendimento. Rascunho não entra (não é manutenção encerrada).
   */
  const maisAntigos = useMemo(() => {
    const mapa = new Map<string, (typeof todas)[number]>()
    const ordenadas = [...(todas ?? [])]
      .filter((e) => e.status !== 'rascunho')
      .sort((a, b) => Date.parse(a.dataHora) - Date.parse(b.dataHora))
    for (const exec of ordenadas) {
      const nome = exec.camposFixos.equipamento?.trim()
      if (nome && !mapa.has(nome)) mapa.set(nome, exec)
    }
    return [...mapa.values()].slice(0, 3)
  }, [todas])

  /** Os três equipamentos com manutenção mais recente: a lista começa por eles. */
  const ultimosEquipamentos = useMemo(() => {
    const ordem = [...(todas ?? [])]
      .filter((e) => e.status !== 'rascunho')
      .sort((a, b) => Date.parse(b.dataHora) - Date.parse(a.dataHora))
    const nomes: string[] = []
    for (const exec of ordem) {
      const nome = exec.camposFixos.equipamento?.trim()
      if (nome && !nomes.includes(nome)) nomes.push(nome)
      if (nomes.length === 3) break
    }
    return nomes
  }, [todas])

  const [menuAberto, setMenuAberto] = useState(false)
  /**
   * A home mostra uma caixa por vez. Rascunho é trabalho em andamento; Mais
   * recente e Prioridade são as duas leituras do histórico de manutenções.
   */
  const [caixa, setCaixa] = useState<'rascunho' | 'recente' | 'prioridade'>('rascunho')

  // A aba escolhida sobrevive ao recarregar e a voltar de uma ficha concluída:
  // quem está na seccionadora não quer cair em contator toda vez.
  const [grupo, setGrupoState] = useState<string>(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_GRUPO)
      if (salvo && GRUPOS.some((g) => g.id === salvo)) return salvo
    } catch {
      // localStorage bloqueado (modo privado): cai no primeiro grupo
    }
    return GRUPOS[0].id
  })

  const setGrupo = (id: string) => {
    setGrupoState(id)
    try {
      localStorage.setItem(CHAVE_GRUPO, id)
    } catch {
      // sem persistência, a aba vale só nesta sessão
    }
  }
  const [busca, setBusca] = useState('')
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])

  // Cadastros podem ser editados em outra tela: recarrega ao abrir e ao voltar.
  useEffect(() => {
    const carregar = () => void lerEquipamentos().then(setEquipamentos)
    carregar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [])

  const filtrados = useMemo(() => {
    const termo = normalizar(busca)
    return equipamentos
      .filter((e) => grupoDaFicha(e.fichaId) === grupo)
      .filter((e) => {
        if (!termo) return true
        const alvo = normalizar(`${e.nome} ${e.local} ${e.marca ?? ''} ${e.serie ?? ''}`)
        return termo.split(/\s+/).every((parte) => alvo.includes(parte))
      })
      .sort((a, b) => {
        // Os três últimos equipamentos atendidos vêm no topo; o resto, alfabético.
        // Quem escolhe a leitura da tela é a etiqueta, não a ordem da lista.
        const ia = ultimosEquipamentos.indexOf(a.nome.trim())
        const ib = ultimosEquipamentos.indexOf(b.nome.trim())
        if (ia !== -1 || ib !== -1) {
          if (ia === -1) return 1
          if (ib === -1) return -1
          return ia - ib
        }
        return a.nome.localeCompare(b.nome, 'pt-BR')
      })
  }, [equipamentos, busca, grupo, ultimosEquipamentos])

  return (
    <div className="min-h-full pb-10">
      <header className="relative bg-gradient-to-br from-blue-800 to-blue-600 px-5 pt-8 pb-7 text-white">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-blue-100 uppercase">Metrô · Manutenção</p>
          <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              online ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/25 text-amber-50'
            }`}
          >
            {online ? <Wifi size={12} /> : <CloudOff size={12} />}
            {online ? 'Online' : 'Offline'}
          </span>
          <button
            onClick={onAlternarTema}
            className="rounded-full bg-white/15 p-1.5 text-white active:bg-white/25"
            aria-label={temaEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={temaEscuro ? 'Modo claro' : 'Modo escuro'}
          >
            {temaEscuro ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => setMenuAberto((v) => !v)}
            className="rounded-full bg-white/15 p-1.5 text-white active:bg-white/25"
            aria-label="Menu"
            aria-expanded={menuAberto}
            title="Menu"
          >
            {menuAberto ? <X size={16} /> : <Menu size={16} />}
          </button>
          </div>
        </div>
        {menuAberto && (
          <>
            {/* toque fora fecha o menu, como qualquer menu nativo */}
            <button
              className="fixed inset-0 z-30 cursor-default"
              aria-label="Fechar menu"
              onClick={() => setMenuAberto(false)}
            />
            <div className="absolute right-4 z-40 mt-1 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <MenuItem
                icone={<Database size={18} />}
                rotulo="Histórico e fila de envio"
                onClick={() => {
                  setMenuAberto(false)
                  onVerHistorico()
                }}
              />
              <MenuItem
                icone={<HardDriveDownload size={18} />}
                rotulo="Backup das execuções"
                onClick={() => {
                  setMenuAberto(false)
                  onVerBackup()
                }}
              />
              {ehAdministrador && (
                <MenuItem
                  icone={<Users size={18} />}
                  rotulo="Equipe e equipamentos"
                  onClick={() => {
                    setMenuAberto(false)
                    onVerCadastros()
                  }}
                />
              )}
            </div>
          </>
        )}
        <h1 className="text-2xl font-bold">Fichas de medição</h1>
        <p className="mt-1 text-sm text-blue-100">
          {naoSincronizadas > 0
            ? `${naoSincronizadas} execução(ões) aguardando sincronização`
            : 'Tudo sincronizado'}
        </p>

        {/* Barra do usuário no rodapé da faixa azul: cabe inteira ao lado do
            status e não abre caixa nova no corpo da página. */}
        <div className="mt-3 flex items-center gap-2">
          <SeletorSessao
            sessao={sessao}
            ehAdministrador={ehAdministrador}
            onEntrar={onEntrar}
            onSair={onSair}
            compacto
          />
        </div>
      </header>

      <div className="space-y-5 p-4">
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
            Novo serviço
          </h2>
          <p className="mb-2 px-1 text-xs text-slate-500">
            Escolha o equipamento — para visualizar dados completos.
          </p>

          <div className="mb-2 grid grid-cols-2 gap-2">
            {GRUPOS.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setGrupo(g.id)
                  setBusca('')
                }}
                className={`rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
                  grupo === g.id ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {g.rotulo}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, local, marca ou série"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {busca && (
              <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca">
                <X size={16} className="text-slate-400" />
              </button>
            )}
          </div>

          <div
            className={`mb-2 grid gap-1.5 ${
              (ultimas?.length ?? 0) > 0 ? 'grid-cols-3' : 'grid-cols-2'
            }`}
          >
            {(
              [
                { id: 'rascunho', rotulo: 'Rascunho', cor: 'bg-amber-600' },
                { id: 'recente', rotulo: 'Mais recente', cor: 'bg-blue-700' },
                { id: 'prioridade', rotulo: 'Prioridade', cor: 'bg-red-700' },
              ] as const
            )
              // Sem rascunho aberto a etiqueta some — não há o que continuar.
              .filter((c) => c.id !== 'rascunho' || (ultimas?.length ?? 0) > 0)
              .map((c) => (
              <button
                key={c.id}
                onClick={() => setCaixa(c.id)}
                className={`rounded-xl px-2 py-2 text-[11px] font-semibold leading-tight transition ${
                  caixa === c.id ? `${c.cor} text-white` : 'bg-slate-100 text-slate-600'
                }`}
              >
                {c.rotulo}
              </button>
            ))}
          </div>

          {caixa !== 'recente' ? null : equipamentos.filter((e) => grupoDaFicha(e.fichaId) === grupo).length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 p-4">
              <p className="text-xs text-slate-600">
                Nenhum equipamento de <strong>{GRUPOS.find((g) => g.id === grupo)?.rotulo}</strong>{' '}
                cadastrado. Cadastre em <strong>Cadastros</strong> — a ficha de cada serviço passa a
                ser escolhida automaticamente pelo equipamento.
              </p>
              {ehAdministrador ? (
                <button
                  onClick={onVerCadastros}
                  className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700"
                >
                  Abrir cadastros
                </button>
              ) : (
                <p className="mt-2 text-xs text-amber-800">
                  Peça a um administrador para cadastrar o contator e liberar as execuções.
                </p>
              )}
            </div>
          ) : filtrados.length === 0 ? (
            <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
              Nenhum contator encontrado para "{busca}".
            </p>
          ) : (
            <div className="max-h-[22rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {filtrados.map((equip) => {
                const ficha = FICHAS.find((f) => f.id === equip.fichaId)
                return (
                  <button
                    key={equip.id}
                    onClick={() => onNovaExecucaoDoEquipamento(equip)}
                    className="flex w-full items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-3.5 text-left shadow-sm active:scale-[0.995] active:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {equip.nome}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {[equip.local, equip.marca, equip.serie].filter(Boolean).join(' · ') ||
                          'sem detalhes'}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-blue-700">
                        {ficha ? ficha.nomeCurto : 'ficha não definida'}
                      </span>
                      <UltimaManutencao exec={ultimaPorEquipamento.get(equip.nome)} />
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-slate-400" />
                  </button>
                )
              })}
              {filtrados.length > 3 && (
                <p className="pt-1 text-center text-[11px] text-slate-400">
                  {filtrados.length} equipamentos — role a lista ou use a busca
                </p>
              )}
            </div>
          )}
        </section>

        {caixa === 'prioridade' && maisAntigos.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
              Tempo sem manutenção
            </h2>
            <p className="mb-2 px-1 text-xs text-slate-500">
              Os três que passaram mais tempo sem serviço — vale dar prioridade.
            </p>
            <div className="space-y-2">
              {maisAntigos.map((exec) => {
                const nome = (exec.camposFixos.equipamento ?? '').trim()
                const equip = equipamentos.find((e) => e.nome.trim() === nome)
                const quando = new Date(exec.dataHora)
                const meses = Math.max(
                  0,
                  Math.floor((Date.now() - quando.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
                )
                return (
                  <button
                    key={exec.id}
                    onClick={() =>
                      equip ? onNovaExecucaoDoEquipamento(equip) : onAbrirExecucao(exec.id)
                    }
                    className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                      <Clock size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {nome || exec.codigo}
                      </span>
                      <span className="block text-xs text-slate-600">
                        última: {quando.toLocaleDateString('pt-BR')} ·{' '}
                        {meses === 0 ? 'menos de 1 mês' : `${meses} ${meses === 1 ? 'mês' : 'meses'}`}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-amber-600" />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {caixa === 'rascunho' && ultimas && ultimas.length > 0 && (
          <section>
            <h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
              Continuar
            </h2>
            <div className="space-y-2">
              {ultimas.map((exec) => (
                <button
                  key={exec.id}
                  onClick={() => onAbrirExecucao(exec.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left"
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      exec.status === 'pendente'
                        ? 'bg-red-600'
                        : exec.status === 'concluida'
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {exec.codigo} · {exec.local || 'sem local'}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {exec.status === 'pendente'
                        ? 'Pendente'
                        : exec.status === 'concluida'
                          ? 'Concluída'
                          : 'Rascunho'}{' '}
                      ·{' '}
                      {new Date(exec.atualizadaEm).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {!exec.sincronizada && ' · pendente'}
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          {naoSincronizadas > 0 && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                As execuções ficam salvas no celular até conseguirem sincronizar. Não é preciso sinal para
                medir — a sincronização acontece quando houver rede.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * Última manutenção do equipamento. Mostra quando foi, o tipo (P1/P2) e o
 * desfecho — é o que o técnico olha antes de abrir um serviço novo.
 */
function UltimaManutencao({ exec }: { exec: Execucao | undefined }) {
  if (!exec) {
    return (
      <span className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
        <Clock size={11} /> sem manutenção registrada
      </span>
    )
  }
  const quando = new Date(exec.dataHora).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-white">
        {exec.tipoManutencao ?? '—'}
      </span>
      <span className="text-[11px] text-slate-600">{quando}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
          exec.status === 'pendente'
            ? 'bg-red-600 text-white'
            : 'bg-emerald-100 text-emerald-800'
        }`}
      >
        {exec.status === 'pendente' ? 'PENDENTE' : 'CONCLUÍDA'}
      </span>
    </span>
  )
}

/** Item do menu suspenso do cabeçalho. */
function MenuItem({
  icone,
  rotulo,
  onClick,
}: {
  icone: React.ReactNode
  rotulo: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 active:bg-slate-50"
    >
      <span className="text-slate-500">{icone}</span>
      <span className="flex-1 text-sm font-medium text-slate-800">{rotulo}</span>
      <ChevronRight size={16} className="text-slate-400" />
    </button>
  )
}
