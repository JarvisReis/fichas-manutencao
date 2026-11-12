import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ChevronRight, ClipboardList, CloudOff, Database, HardDriveDownload, Moon, Plus, Sun, Users, Wifi } from 'lucide-react'
import type { DefinicaoFicha } from '../types'
import { db } from '../lib/db'
import { FICHAS } from '../config/fichas'

interface Props {
  onNovaExecucao: (ficha: DefinicaoFicha) => void
  onAbrirExecucao: (id: string) => void
  onVerHistorico: () => void
  onVerBackup: () => void
  onVerCadastros: () => void
  onAlternarTema: () => void
  temaEscuro: boolean
  online: boolean
}

export default function TelaHome({
  onNovaExecucao,
  onAbrirExecucao,
  onVerHistorico,
  onVerBackup,
  onVerCadastros,
  onAlternarTema,
  temaEscuro,
  online,
}: Props) {
  const pendentes = useLiveQuery(() => db.execucoes.filter((e) => !e.sincronizada).toArray(), [], [])
  const ultimas = useLiveQuery(
    () => db.execucoes.orderBy('atualizadaEm').reverse().limit(2).toArray(),
    [],
    [],
  )

  const naoSincronizadas = pendentes?.length ?? 0

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
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wide text-slate-500 uppercase">
            Nova execução
          </h2>
          <div className="space-y-2">
            {FICHAS.map((ficha) => (
              <button
                key={ficha.id}
                onClick={() => onNovaExecucao(ficha)}
                className="flex w-full items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.995] active:bg-slate-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <ClipboardList size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{ficha.nomeCurto}</span>
                  <span className="block text-xs text-slate-500">{ficha.subtitulo}</span>
                </span>
                <Plus size={18} className="shrink-0 text-blue-700" />
              </button>
            ))}
          </div>
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
                      exec.status === 'concluida' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {exec.codigo} · {exec.local || 'sem local'}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {exec.status === 'concluida' ? 'Concluída' : 'Rascunho'} ·{' '}
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
