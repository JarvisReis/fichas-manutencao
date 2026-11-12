import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, Clock, CloudOff, Database, HardDriveDownload, Moon, Search, Sun, Users, Wifi, X } from 'lucide-react'
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

  /** Última execução de cada equipamento, para o cartão mostrar a manutenção feita. */
  const todas = useLiveQuery(() => db.execucoes.toArray(), [], [])
  const ultimaPorEquipamento = useMemo(() => {
    const mapa = new Map<string, { exec: (typeof todas)[number]; total: number }>()
    const ordenadas = [...(todas ?? [])]
      .filter((e) => e.status !== 'rascunho')
      .sort((a, b) => Date.parse(b.dataHora) - Date.parse(a.dataHora))
    for (const exec of ordenadas) {
      const nome = exec.camposFixos.equipamento?.trim()
      if (!nome) continue
      const atual = mapa.get(nome)
      // Rascunho não entra: o cartão mostra a última manutenção encerrada, e a
      // contagem é o total de manutenções fechadas daquele equipamento.
      if (atual) mapa.set(nome, { exec: atual.exec, total: atual.total + 1 })
      else mapa.set(nome, { exec, total: 1 })
    }
    return mapa
  }, [todas])

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
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [equipamentos, busca, grupo])

  return (
    <div className="min-h-full pb-10">
      <header className="bg-gradient-to-br from-blue-800 to-blue-600 px-5 pt-8 pb-7 text-white">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-blue-100 uppercase">Metrô · Manutenção</p>
          <div className="flex items-center gap-2">
          <button
            onClick={onAlternarTema}
            className="rounded-full bg-white/15 p-1.5 text-white active:bg-white/25"
            aria-label={temaEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={temaEscuro ? 'Modo claro' : 'Modo escuro'}
          >
            {temaEscuro ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              online ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/25 text-amber-50'
            }`}
          >
            {online ? <Wifi size={12} /> : <CloudOff size={12} />}
            {online ? 'Online' : 'Offline'}
          </span>
          </div>
        </div>
        <h1 className="text-2xl font-bold">Fichas de medição</h1>
        <p className="mt-1 text-sm text-blue-100">
          {naoSincronizadas > 0
            ? `${naoSincronizadas} execução(ões) aguardando sincronização`
            : 'Tudo sincronizado'}
        </p>
      </header>

      <div className="space-y-5 p-4">
        <SeletorSessao
          sessao={sessao}
          ehAdministrador={ehAdministrador}
          onEntrar={onEntrar}
          onSair={onSair}
        />

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

          {equipamentos.filter((e) => grupoDaFicha(e.fichaId) === grupo).length === 0 ? (
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
            <div className="space-y-2">
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
                      <UltimaManutencao
                        exec={ultimaPorEquipamento.get(equip.nome)?.exec}
                        total={ultimaPorEquipamento.get(equip.nome)?.total ?? 0}
                      />
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-slate-400" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {ultimas && ultimas.length > 0 && (
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
          <button
            onClick={onVerHistorico}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <Database size={20} />
            </span>
            <span className="flex-1 text-sm font-medium text-slate-800">Histórico e fila de envio</span>
            <ChevronRight size={18} className="text-slate-400" />
          </button>

          <button
            onClick={onVerBackup}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <HardDriveDownload size={20} />
            </span>
            <span className="flex-1 text-sm font-medium text-slate-800">Backup das execuções</span>
            <ChevronRight size={18} className="text-slate-400" />
          </button>

          {ehAdministrador && (
            <button
              onClick={onVerCadastros}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Users size={20} />
              </span>
              <span className="flex-1 text-sm font-medium text-slate-800">Equipe e equipamentos</span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          )}

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
 * Última manutenção daquele equipamento. Mostra quando foi, que tipo (P1/P2) e
 * se está concluída — é o que o técnico olha antes de abrir um serviço novo.
 */
function UltimaManutencao({ exec, total }: { exec: Execucao | undefined; total: number }) {
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
  const tipo = exec.tipoManutencao ?? '—'
  const aberta = exec.status !== 'concluida'
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold text-white">{tipo}</span>
      <span className="text-[11px] text-slate-600">{quando}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
          exec.status === 'pendente'
            ? 'bg-red-600 text-white'
            : aberta
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800'
        }`}
      >
        {exec.status === 'pendente' ? 'PENDENTE' : aberta ? 'RASCUNHO' : 'CONCLUÍDA'}
      </span>
      {total > 1 && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
          {total} MANUT.
        </span>
      )}
    </span>
  )
}
