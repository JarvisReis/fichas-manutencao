import { useRef, useState } from 'react'
import { ArrowLeft, Download, HardDriveDownload, Share2, Upload } from 'lucide-react'
import {
  compartilharBackup,
  compartilharExecucao,
  exportarBackup,
  exportarExecucao,
  importarBackup,
} from '../lib/backup'
import { db, lerEndpointSync } from '../lib/db'
import { getFicha } from '../config/fichas'
import { enviarExecucao as enviarParaServidor, sincronizarPendentes } from '../lib/sync'

interface Props {
  onVoltar: () => void
  onRestaurado: () => void
  /** reabrir ficha concluída exige administrador; usado no reenvio de correção */
  ehAdministrador: boolean
}

export default function TelaBackup({ onVoltar, onRestaurado, ehAdministrador }: Props) {
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputArquivo = useRef<HTMLInputElement>(null)
  const [endpoint, setEndpoint] = useState(() => lerEndpointSync())
  const [pendentes, setPendentes] = useState<number | null>(null)
  const [progresso, setProgresso] = useState<string | null>(null)

  const contarPendentes = async () => {
    const total = await db.execucoes.filter((e) => !e.sincronizada).count()
    setPendentes(total)
  }
  const [listaEnvios, setListaEnvios] = useState<
    { id: string; codigo: string; titulo: string; quando: string }[] | null
  >(null)

  const abrirListaEnvios = async () => {
    await contarPendentes()
    const execs = await db.execucoes.orderBy('atualizadaEm').reverse().toArray()
    setListaEnvios(
      execs.map((e) => ({
        id: e.id,
        codigo: e.codigo,
        titulo: `${getFicha(e.fichaId)?.nomeCurto ?? e.fichaId} · ${e.local || 'sem local'}`,
        quando: new Date(e.dataHora).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      })),
    )
  }

  const enviarExecucao = async (id: string) => {
    setProcessando(true)
    setErro(null)
    setMensagem(null)
    try {
      if (endpoint.trim()) {
        const r = await enviarParaServidor(id, endpoint.trim(), {
          reenvioAdmin: ehAdministrador,
        })
        if (r.ok) {
          setMensagem('Execução sincronizada com o SharePoint.')
          await contarPendentes()
        } else {
          setErro(`Falha ao sincronizar: ${r.erro}`)
        }
        return
      }
      const enviado = await compartilharExecucao(id)
      if (enviado) {
        setMensagem('Arquivo enviado pelo menu de compartilhamento.')
      } else {
        const r = await exportarExecucao(id)
        setMensagem(`Arquivo ${r.nome} gerado (${(r.bytes / 1024).toFixed(0)} KB).`)
      }
    } catch (e) {
      setErro(`Falha ao enviar: ${(e as Error).message}`)
    } finally {
      setProcessando(false)
    }
  }

  const sincronizarTudo = async () => {
    const alvo = endpoint.trim()
    if (!alvo) {
      setErro('Configure o endereço de sincronização antes de enviar.')
      return
    }
    setProcessando(true)
    setErro(null)
    setMensagem(null)
    setProgresso(null)
    try {
      const r = await sincronizarPendentes(alvo, (feitas, total) =>
        setProgresso(`Enviando ${feitas} de ${total}…`),
      )
      const partes = [`${r.gravadas} execução(ões) sincronizada(s).`]
      if (r.ignoradas > 0) partes.push(`${r.ignoradas} já existiam.`)
      if (r.falhas.length > 0) {
        partes.push(
          `Falha em ${r.falhas.length}: ${r.falhas
            .slice(0, 2)
            .map((f) => `${f.codigo} (${f.erro})`)
            .join('; ')}`,
        )
      }
      setMensagem(partes.join(' '))
      await contarPendentes()
    } catch (e) {
      setErro(`Falha ao sincronizar: ${(e as Error).message}`)
    } finally {
      setProgresso(null)
      setProcessando(false)
    }
  }

  const exportar = async () => {
    setProcessando(true)
    setErro(null)
    try {
      const r = await exportarBackup()
      const mb = (r.bytes / 1024 / 1024).toFixed(2)
      setMensagem(`Backup gerado: ${r.execucoes} execução(ões), ${r.fotos} foto(s), ${mb} MB.`)
    } catch (e) {
      setErro(`Falha ao exportar: ${(e as Error).message}`)
    } finally {
      setProcessando(false)
    }
  }

  const compartilhar = async () => {
    setProcessando(true)
    setErro(null)
    try {
      const enviado = await compartilharBackup()
      if (enviado) {
        setMensagem('Backup enviado pelo menu de compartilhamento.')
      } else {
        await exportar()
      }
    } catch (e) {
      setErro(`Falha ao compartilhar: ${(e as Error).message}`)
    } finally {
      setProcessando(false)
    }
  }

  const importar = async (arquivo: File | undefined | null) => {
    if (!arquivo) return
    setProcessando(true)
    setErro(null)
    setMensagem(null)
    try {
      const texto = await arquivo.text()
      const r = await importarBackup(texto)
      setMensagem(
        `Importado: ${r.execucoes} execução(ões) e ${r.fotos} foto(s).` +
          (r.ignoradas > 0 ? ` ${r.ignoradas} já existiam e foram mantidas.` : ''),
      )
      onRestaurado()
    } catch (e) {
      setErro(`Falha ao importar: ${(e as Error).message}`)
    } finally {
      setProcessando(false)
    }
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
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Backup</p>
            <p className="text-xs text-slate-500">Cópia de segurança das execuções</p>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-xs leading-relaxed text-amber-900">
            As execuções ficam salvas apenas neste aparelho até a sincronização com o SharePoint
            existir. Se o celular for perdido, trocado ou o app for desinstalado, os dados se perdem.
            Gere um backup ao fim de cada turno de medições.
          </p>
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Sincronização</h3>
          <p className="mb-3 text-xs text-slate-500">
            Endereço do serviço de sincronização usado quando o celular está com rede. Sem ele, o
            envio funciona pelo compartilhamento de arquivo.
          </p>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">
              Endereço de sincronização
            </span>
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://seu-servidor/fichas"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>

          <div className="mt-3 space-y-2">
            <button
              onClick={() => void sincronizarTudo()}
              disabled={processando || !endpoint.trim()}
              className="w-full rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
            >
              Enviar pendentes ({pendentes ?? '…'})
            </button>
            <button
              onClick={() => void contarPendentes()}
              disabled={processando}
              className="w-full rounded-xl border-2 border-slate-300 py-2.5 text-xs font-semibold text-slate-700 disabled:text-slate-400"
            >
              Atualizar contagem
            </button>
          </div>
          {progresso && <p className="mt-2 text-[11px] text-slate-600">{progresso}</p>}
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Enviar para o SharePoint</h3>
          <p className="mb-3 text-xs text-slate-500">
            Envia <strong>uma execução por arquivo</strong>, no formato que o fluxo do Power Automate
            lê. No celular, escolha salvar no OneDrive/SharePoint — o fluxo processa automaticamente.
          </p>

          {listaEnvios === null ? (
            <button
              onClick={() => void abrirListaEnvios()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white"
            >
              <Share2 size={18} /> Escolher execução para enviar
            </button>
          ) : listaEnvios.length === 0 ? (
            <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
              Nenhuma execução registrada ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {listaEnvios.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-900">{item.codigo}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {item.titulo} · {item.quando}
                    </p>
                  </div>
                  <button
                    onClick={() => void enviarExecucao(item.id)}
                    disabled={processando}
                    className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-[11px] font-semibold text-white disabled:bg-slate-300"
                  >
                    Enviar
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Exportar tudo</h3>
          <p className="mb-3 text-xs text-slate-500">
            Gera um arquivo com todas as execuções e as fotos incluídas.
          </p>

          <div className="space-y-2">
            <button
              onClick={() => void compartilhar()}
              disabled={processando}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
            >
              <Share2 size={18} /> Compartilhar backup
            </button>
            <button
              onClick={() => void exportar()}
              disabled={processando}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700 disabled:text-slate-400"
            >
              <Download size={18} /> Baixar arquivo
            </button>
          </div>
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <HardDriveDownload size={16} /> Importar
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Restaura um backup exportado. Execuções que já existem no aparelho não são sobrescritas.
          </p>
          <button
            onClick={() => inputArquivo.current?.click()}
            disabled={processando}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700 disabled:text-slate-400"
          >
            <Upload size={18} /> Selecionar arquivo de backup
          </button>
          <input
            ref={inputArquivo}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void importar(e.target.files?.[0])
              e.currentTarget.value = ''
            }}
          />
        </section>

        {processando && (
          <p className="text-center text-xs font-medium text-slate-500">Processando…</p>
        )}

        {mensagem && (
          <p className="rounded-xl bg-emerald-50 p-3 text-xs font-medium text-emerald-800">{mensagem}</p>
        )}

        {erro && (
          <p className="rounded-xl bg-red-50 p-3 text-xs font-medium text-red-800">{erro}</p>
        )}
      </div>
    </div>
  )
}
