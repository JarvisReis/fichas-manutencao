import { useEffect, useState } from 'react'
import { ArrowLeft, CloudDownload, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react'
import { restaurarPacote, type PacoteBackup } from '../lib/backup'
import { baixarBackup, listarBackups } from '../lib/sync'
import { lerEndpointSync } from '../lib/db'

interface Props {
  onVoltar: () => void
  onRestaurado: () => void
  ehAdministrador: boolean
}

/** Um backup como o servidor lista: só o resumo, sem o conteúdo das fichas. */
interface ResumoBackup {
  id: number
  criado_em: string
  origem: string
  aparelho: string | null
  execucoes: number
  equipamentos: number
  pessoas: number
}

const dataLegivel = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Recuperação de fichas a partir das cópias guardadas no servidor.
 *
 * Existe por causa de uma perda real: uma ficha de homologação vivia só no
 * IndexedDB de um aparelho, o técnico limpou o cache e ela deixou de existir em
 * todo lugar. O backup automático passou a guardar o pacote no servidor; esta
 * tela é o caminho de volta.
 *
 * A restauração nunca destrói o que já está aqui: ficha com o mesmo id é
 * ignorada, cadastro já conhecido não é duplicado. Recuperar não pode virar
 * uma segunda perda.
 */
export default function TelaRecuperacao({ onVoltar, onRestaurado, ehAdministrador }: Props) {
  const [backups, setBackups] = useState<ResumoBackup[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<ResumoBackup | null>(null)
  const [restaurando, setRestaurando] = useState(false)

  const endpoint = lerEndpointSync()

  const carregar = async () => {
    if (!endpoint) {
      setErro('Sem endereço de sincronização configurado. Ajuste em Backup.')
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      const r = await listarBackups(endpoint)
      if (!r.ok) {
        setErro(r.erro ?? 'Não foi possível listar os backups.')
        return
      }
      setBackups((r.backups ?? []) as ResumoBackup[])
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (ehAdministrador) void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehAdministrador])

  const restaurar = async (backup: ResumoBackup) => {
    if (restaurando) return
    setRestaurando(true)
    setErro(null)
    setAviso(null)
    try {
      const r = await baixarBackup(endpoint, backup.id)
      if (!r.ok || !r.conteudo) {
        setErro(r.erro ?? 'Backup não encontrado no servidor.')
        setConfirmando(null)
        return
      }
      const resultado = await restaurarPacote(r.conteudo as PacoteBackup)
      setConfirmando(null)
      setAviso(
        resultado.execucoes === 0 && resultado.ignoradas > 0
          ? `Nada a recuperar: as ${resultado.ignoradas} ficha(s) deste backup já estão neste aparelho.`
          : `${resultado.execucoes} ficha(s) recuperada(s)` +
            (resultado.equipamentos ? `, ${resultado.equipamentos} equipamento(s)` : '') +
            (resultado.pessoas ? `, ${resultado.pessoas} pessoa(s)` : '') +
            (resultado.ignoradas ? `. ${resultado.ignoradas} já existia(m) e não foi(ram) tocada(s).` : '.'),
      )
      onRestaurado()
    } catch (e) {
      setErro((e as Error).message)
      setConfirmando(null)
    } finally {
      setRestaurando(false)
    }
  }

  if (!ehAdministrador) {
    return (
      <div className="min-h-full pb-10">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              onClick={onVoltar}
              className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
              aria-label="Voltar"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h2 className="text-base font-bold text-slate-900">Recuperação</h2>
              <p className="text-xs text-slate-500">Cópias guardadas no servidor</p>
            </div>
          </div>
        </header>
        <div className="p-4">
          <p className="rounded-2xl border-2 border-slate-200 bg-white p-4 text-xs text-slate-600">
            Só o administrador recupera fichas. Se você perdeu dados neste aparelho, peça a ele para
            restaurar — as cópias ficam todas no servidor.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900">Recuperação</h2>
            <p className="text-xs text-slate-500">Cópias guardadas no servidor</p>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <section className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-2">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-blue-700" />
            <p className="text-xs leading-relaxed text-blue-900">
              A cada sincronização o aparelho manda uma cópia completa para o servidor. Se um
              celular for limpo, perdido ou trocado, as fichas voltam por aqui — <strong>sem
              apagar</strong> nada que já exista neste aparelho.
            </p>
          </div>
        </section>

        {erro && (
          <p className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-xs font-medium text-red-800">
            {erro}
          </p>
        )}
        {aviso && (
          <p className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
            {aviso}
          </p>
        )}

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Cópias disponíveis</h3>
            <button
              onClick={() => void carregar()}
              disabled={carregando}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-700 active:bg-blue-50 disabled:text-slate-400"
            >
              <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>

          {backups === null ? (
            <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
              {carregando ? 'Buscando cópias no servidor…' : 'Toque em Atualizar para buscar.'}
            </p>
          ) : backups.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-300 p-4">
              <p className="text-xs text-slate-600">
                Nenhuma cópia no servidor ainda. Ela é criada sozinha na primeira sincronização com
                fichas ou equipamentos no aparelho.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {backups.map((b) => (
                <li key={b.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">{dataLegivel(b.criado_em)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {b.origem === 'manual' ? 'Manual' : 'Automática'}
                        {b.aparelho ? ` · ${b.aparelho}` : ''}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {b.execucoes} ficha(s) · {b.equipamentos} equipamento(s) · {b.pessoas}{' '}
                        pessoa(s)
                      </p>
                    </div>
                    <button
                      onClick={() => setConfirmando(b)}
                      disabled={restaurando}
                      className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-[11px] font-semibold text-white disabled:bg-slate-300"
                    >
                      Recuperar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-1 text-[11px] leading-relaxed text-slate-500">
          O servidor guarda as 60 cópias mais recentes. Cópias antigas saem sozinhas para não encher
          o banco.
        </p>
      </div>

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <CloudDownload size={20} className="text-blue-700" />
              <h3 className="text-sm font-bold text-slate-900">Recuperar esta cópia?</h3>
            </div>
            <p className="mb-1 text-xs text-slate-600">
              {dataLegivel(confirmando.criado_em)}
              {confirmando.aparelho ? ` · ${confirmando.aparelho}` : ''}
            </p>
            <p className="mb-4 text-xs text-slate-600">
              {confirmando.execucoes} ficha(s) e {confirmando.equipamentos} equipamento(s) serão
              trazidos para este aparelho. Fichas que já estão aqui <strong>não são alteradas</strong>.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmando(null)}
                disabled={restaurando}
                className="rounded-xl border-2 border-slate-300 py-2.5 text-xs font-semibold text-slate-700 disabled:text-slate-400"
              >
                Cancelar
              </button>
              <button
                onClick={() => void restaurar(confirmando)}
                disabled={restaurando}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-700 py-2.5 text-xs font-semibold text-white disabled:bg-slate-300"
              >
                <RotateCcw size={16} />
                {restaurando ? 'Recuperando…' : 'Recuperar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
