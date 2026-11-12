import { useCallback, useEffect, useState } from 'react'
import type { DefinicaoFicha, Execucao } from './types'
import { db, gerarCodigo } from './lib/db'
import { getFicha } from './config/fichas'
import TelaHome from './pages/TelaHome'
import TelaIdentificacao from './pages/TelaIdentificacao'
import TelaExecucao from './pages/TelaExecucao'
import TelaHistorico from './pages/TelaHistorico'
import TelaBackup from './pages/TelaBackup'
import TelaCadastros from './pages/TelaCadastros'
import { useTema } from './lib/tema'

type Rota =
  | { nome: 'home' }
  | { nome: 'identificacao'; ficha: DefinicaoFicha; execucao: Execucao }
  | { nome: 'execucao'; ficha: DefinicaoFicha; execucao: Execucao }
  | { nome: 'historico' }
  | { nome: 'backup' }
  | { nome: 'cadastros' }
  | { nome: 'salvo'; execucao: Execucao }

export default function App() {
  const [rota, setRota] = useState<Rota>({ nome: 'home' })
  const [online, setOnline] = useState(navigator.onLine)
  const { tema, alternar } = useTema()

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const atualizarExecucao = useCallback(
    (id: string, patch: Partial<Execucao>) => {
      setRota((atual) => {
        if ((atual.nome === 'identificacao' || atual.nome === 'execucao') && atual.execucao.id === id) {
          const atualizada = { ...atual.execucao, ...patch, atualizadaEm: new Date().toISOString() }
          void db.execucoes.put(atualizada)
          return { ...atual, execucao: atualizada } as Rota
        }
        return atual
      })
    },
    [],
  )

  const novaExecucao = async (ficha: DefinicaoFicha) => {
    const existentes = await db.execucoes.toArray()
    const agora = new Date()
    const execucao: Execucao = {
      id: crypto.randomUUID(),
      codigo: gerarCodigo(ficha.prefixo, existentes),
      fichaId: ficha.id,
      cabecalho: {},
      camposFixos: {},
      local: '',
      dataHora: agora.toISOString(),
      valores: ficha.itens.map((item) => ({ itemId: item.id, valor: '' })),
      status: 'rascunho',
      sincronizada: false,
      criadaEm: agora.toISOString(),
      atualizadaEm: agora.toISOString(),
    }
    await db.execucoes.put(execucao)
    setRota({ nome: 'identificacao', ficha, execucao })
  }

  const abrirExecucao = async (id: string) => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) return
    const ficha = getFicha(execucao.fichaId)
    if (!ficha) return
    setRota({ nome: 'execucao', ficha, execucao })
  }

  const salvarExecucao = async (id: string, status: 'rascunho' | 'concluida') => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) return
    const atualizada: Execucao = { ...execucao, status, atualizadaEm: new Date().toISOString() }
    await db.execucoes.put(atualizada)
    if (status === 'concluida') {
      setRota({ nome: 'salvo', execucao: atualizada })
    } else {
      setRota({ nome: 'home' })
    }
  }

  switch (rota.nome) {
    case 'identificacao':
      return (
        <TelaIdentificacao
          ficha={rota.ficha}
          execucao={rota.execucao}
          onVoltar={() => setRota({ nome: 'home' })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onContinuar={() => setRota({ nome: 'execucao', ficha: rota.ficha, execucao: rota.execucao })}
        />
      )

    case 'execucao':
      return (
        <TelaExecucao
          ficha={rota.ficha}
          execucao={rota.execucao}
          onVoltar={() => setRota({ nome: 'identificacao', ficha: rota.ficha, execucao: rota.execucao })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onSalvar={(status) => void salvarExecucao(rota.execucao.id, status)}
        />
      )

    case 'historico':
      return (
        <TelaHistorico
          onVoltar={() => setRota({ nome: 'home' })}
          onAbrir={(id) => void abrirExecucao(id)}
        />
      )

    case 'cadastros':
      return <TelaCadastros onVoltar={() => setRota({ nome: 'home' })} />

    case 'backup':
      return (
        <TelaBackup
          onVoltar={() => setRota({ nome: 'home' })}
          onRestaurado={() => setRota({ nome: 'home' })}
        />
      )

    case 'salvo':
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">
            ✓
          </div>
          <h1 className="text-lg font-bold text-slate-900">Execução concluída</h1>
          <p className="max-w-xs text-sm text-slate-600">
            {rota.execucao.codigo} foi salva no aparelho e ficará na fila até sincronizar com o
            SharePoint.
          </p>
          <button
            onClick={() => setRota({ nome: 'home' })}
            className="mt-2 w-full max-w-xs rounded-xl bg-blue-700 py-3.5 text-sm font-semibold text-white active:bg-blue-800"
          >
            Voltar ao início
          </button>
          <button
            onClick={() => setRota({ nome: 'historico' })}
            className="w-full max-w-xs rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Ver histórico
          </button>
        </div>
      )

    default:
      return (
        <TelaHome
          online={online}
          onNovaExecucao={(ficha) => void novaExecucao(ficha)}
          onAbrirExecucao={(id) => void abrirExecucao(id)}
          onVerHistorico={() => setRota({ nome: 'historico' })}
          onVerBackup={() => setRota({ nome: 'backup' })}
          onVerCadastros={() => setRota({ nome: 'cadastros' })}
          onAlternarTema={alternar}
          temaEscuro={tema === 'escuro'}
        />
      )
  }
}
