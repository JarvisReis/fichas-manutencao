import { useCallback, useEffect, useRef, useState } from 'react'
import type { DefinicaoFicha, Execucao } from './types'
import { db, gerarCodigo, limparRascunhosVencidos, limparRgOrgaoGravado } from './lib/db'
import { getFicha } from './config/fichas'
import { lerEquipamentos, lerPessoas, type Equipamento } from './lib/cadastros'
import { podeEditarExecucao } from './lib/permissoes'
import { useSessao } from './lib/sessao'
import SeletorSessao from './components/SeletorSessao'
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
  | { nome: 'ficha'; ficha: DefinicaoFicha; execucao: Execucao; equipamento: Equipamento | null }
  | { nome: 'salvo'; execucao: Execucao; equipamento: Equipamento | null }
  // Rota lida da URL que ainda precisa do banco para abrir (carrega o id).
  | { nome: 'home'; pendente?: { nome: string; id: string } }

/**
 * Grava a tela na URL, para recarregar ou reabrir o app na mesma tela.
 *
 * Duas camadas:
 *  - telas que não dependem de dados (`#/historico`, `#/backup`, ...)
 *  - telas que abrem uma execução, que carregam o id: `#/execucao/<id>`,
 *    `#/ficha/<id>`, `#/identificacao/<id>`
 *
 * Sem o id na URL, recarregar no meio de uma ficha jogava o técnico de volta
 * para a home e ele tinha que achar o equipamento outra vez — o pior momento
 * possível, porque a ficha estava pela metade.
 */
const ROTAS_NA_URL = new Set(['historico', 'backup', 'cadastros'])
const ROTAS_COM_ID = new Set(['identificacao', 'execucao', 'ficha'])

/** Hash da rota, ou '' para a home. */
function hashDaRota(rota: Rota): string {
  if (ROTAS_NA_URL.has(rota.nome)) return `#/${rota.nome}`
  if (ROTAS_COM_ID.has(rota.nome) && 'execucao' in rota) {
    return `#/${rota.nome}/${encodeURIComponent(rota.execucao.id)}`
  }
  return ''
}

function rotaDaUrl(): Rota {
  // `#/execucao/<id>` — o id pode conter caractere escapado, então separa no
  // primeiro '/' depois do nome e decodifica o resto como id inteiro.
  const alvo = window.location.hash.replace(/^#\/?/, '')
  const barra = alvo.indexOf('/')
  const nome = barra === -1 ? alvo : alvo.slice(0, barra)
  const id = barra === -1 ? '' : alvo.slice(barra + 1)
  if (ROTAS_NA_URL.has(nome)) return { nome } as Rota
  // Rota com id é resolvida depois, quando o banco estiver disponível.
  if (ROTAS_COM_ID.has(nome) && id) {
    return { nome: 'home', pendente: { nome, id: decodeURIComponent(id) } } as Rota
  }
  return { nome: 'home' }
}

export default function App() {
  const [rota, setRotaState] = useState<Rota>(rotaDaUrl)

  /** Troca de tela mantendo a URL em sincronia com o que está aberto. */
  const setRota: typeof setRotaState = (valor) => {
    setRotaState((atual) => {
      const proxima = typeof valor === 'function' ? valor(atual) : valor
      const hash = hashDaRota(proxima)
      if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${window.location.search}${hash}`
        window.history.replaceState(null, '', url)
      }
      return proxima
    })
  }

  // Botão voltar do navegador/aparelho: a URL manda na tela.
  useEffect(() => {
    const aoMudarHash = () => setRotaState(rotaDaUrl())
    window.addEventListener('hashchange', aoMudarHash)
    return () => window.removeEventListener('hashchange', aoMudarHash)
  }, [])
  const [online, setOnline] = useState(navigator.onLine)
  const { tema, alternar } = useTema()
  const { sessao, entrar, sair: sairSessao, ehAdministrador } = useSessao()

  /**
   * Sair encerra o uso do aparelho: limpa a sessão, volta para a home e FECHA.
   * Num PWA instalado `window.close()` não funciona, então a tela final pede
   * para fechar — mas como a sessão já saiu, o app fica só em leitura de
   * qualquer forma.
   */
  const sair = useCallback(() => {
    sairSessao()
    setRotaState({ nome: 'home' })
    window.close()
  }, [sairSessao])

  // Quantas pessoas existem no cadastro. Com zero, o administrador ainda não
  // existe e o app precisa abrir a tela de cadastros — senão nasce trancado.
  const [identificando, setIdentificando] = useState(false)
  const [totalPessoas, setTotalPessoas] = useState<number | null>(null)
  useEffect(() => {
    const contar = () => void lerPessoas().then((l) => setTotalPessoas(l.length))
    contar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') contar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [rota])

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

  /** Revalida a sessão contra o cadastro: pessoa desativada ou rebaixada perde o acesso. */
  const validarSessao = useCallback(async () => {
    if (!sessao) return
    const pessoas = await lerPessoas()
    const pessoa = pessoas.find((p) => p.id === sessao.pessoaId)
    if (!pessoa || !pessoa.ativo || pessoa.nivel !== sessao.nivel) sair()
  }, [sessao, sair])

  useEffect(() => {
    void validarSessao()
  }, [validarSessao])

  /**
   * Abre uma execução a partir do contator escolhido: a ficha e o local vêm do
   * cadastro do equipamento, não de uma escolha manual.
   */
  const novaExecucaoDoEquipamento = async (equipamento: Equipamento) => {
    const ficha = getFicha(equipamento.fichaId)
    if (!ficha) return
    const existentes = await db.execucoes.toArray()
    const agora = new Date()
    const execucao: Execucao = {
      id: crypto.randomUUID(),
      codigo: gerarCodigo(equipamento.nome, agora, existentes),
      fichaId: ficha.id,
      cabecalho: {},
      camposFixos: { equipamento: equipamento.nome },
      local: equipamento.local ?? '',
      dataHora: agora.toISOString(),
      valores: ficha.itens.map((item) => ({ itemId: item.id, valor: '' })),
      status: 'rascunho',
      criadaPor: sessao?.pessoaId,
      sincronizada: false,
      criadaEm: agora.toISOString(),
      atualizadaEm: agora.toISOString(),
    }
    await db.execucoes.put(execucao)
    setRota({ nome: 'identificacao', ficha, execucao })
  }

  /**
   * Toque no equipamento da home: abre a ÚLTIMA manutenção dele, não uma ficha
   * em branco. É o que o técnico quer ver — o que foi feito e quando. A ficha
   * nova só nasce pelo botão "Nova manutenção" dessa tela.
   */
  const abrirUltimaManutencao = async (equipamento: Equipamento) => {
    const nome = equipamento.nome.trim()
    const todas = await db.execucoes.toArray()
    const doEquipamento = todas
      .filter((e) => (e.camposFixos.equipamento ?? '').trim() === nome)
      .sort((a, b) => Date.parse(b.dataHora) - Date.parse(a.dataHora))

    if (doEquipamento.length === 0) {
      await novaExecucaoDoEquipamento(equipamento)
      return
    }

    const ultima = doEquipamento[0]
    const ficha = getFicha(ultima.fichaId)
    if (!ficha) return

    // Rascunho abre para edição (é trabalho em andamento); concluída abre em
    // leitura, com o botão de nova manutenção no rodapé.
    if (ultima.status === 'rascunho') {
      if (!podeEditarExecucao(ultima, sessao, ultima.criadaPor).pode) {
        await novaExecucaoDoEquipamento(equipamento)
        return
      }
      setRota({ nome: 'execucao', ficha, execucao: ultima })
      return
    }

    setRota({ nome: 'ficha', ficha, execucao: ultima, equipamento })
  }

  /**
   * Abre a execução para edição. Rascunho é de quem executa; ficha concluída é
   * registro fechado — só administrador reabre (e o histórico avisa antes).
   */
  const abrirExecucao = async (id: string) => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) return
    if (!podeEditarExecucao(execucao, sessao, execucao.criadaPor).pode) return
    const ficha = getFicha(execucao.fichaId)
    if (!ficha) return
    setRota({ nome: 'execucao', ficha, execucao })
  }

  /** Equipamento cadastrado correspondente ao nome gravado na execução. */
  const equipamentoDaExecucao = async (execucao: Execucao): Promise<Equipamento | null> => {
    const nome = (execucao.camposFixos.equipamento ?? '').trim()
    const lista = await lerEquipamentos()
    const achado = lista.find((e) => e.nome.trim() === nome)
    if (achado) return achado
    // equipamento digitado à mão (não cadastrado): reaproveita a ficha e o local
    const ficha = getFicha(execucao.fichaId)
    if (!ficha || !nome) return null
    return {
      id: `avulso:${nome}`,
      nome,
      local: execucao.local,
      fichaId: ficha.id,
    } as Equipamento
  }

  /** Equipamento mínimo a partir da própria execução, quando nada mais resolve. */
  const equipamentoAvulso = (execucao: Execucao): Equipamento => {
    const ficha = getFicha(execucao.fichaId)
    const nome = (execucao.camposFixos.equipamento ?? '').trim() || 'Equipamento sem nome'
    return {
      id: `avulso:${nome}`,
      nome,
      local: execucao.local ?? '',
      fichaId: ficha?.id ?? execucao.fichaId,
    } as Equipamento
  }

  /**
   * Limpa rascunhos vencidos antes de restaurar qualquer tela.
   *
   * Vem primeiro de propósito: se a URL aponta para um rascunho de 6 dias
   * atrás, ele já não existe quando a restauração procura — e a queda para a
   * home já é o comportamento esperado para execução que sumiu.
   */
  const limpezaFeita = useRef(false)
  useEffect(() => {
    if (limpezaFeita.current) return
    limpezaFeita.current = true
    void (async () => {
      // Sujeira de RG gravada por versão antiga: tira do banco antes de
      // qualquer tela ler a ficha, senão o chip "Fora do cadastro" volta.
      await limparRgOrgaoGravado().catch(() => {})
      await limparRascunhosVencidos().catch(() => {})
    })()
  }, [])

  /**
   * Restaura a tela que estava aberta quando a página foi recarregada.
   *
   * Roda uma vez, depois que o banco responde: a URL só guarda o id, e é
   * preciso reler a execução e a ficha para remontar a rota. Se a execução
   * sumiu (apagada em outro aparelho) ou a sessão não permite editar, cai na
   * home sem barulho — restaurar não pode virar um erro na cara do técnico.
   */
  const restauracaoFeita = useRef(false)
  useEffect(() => {
    if (restauracaoFeita.current) return
    const pendente = (rota as { pendente?: { nome: string; id: string } }).pendente
    if (!pendente) {
      restauracaoFeita.current = true
      return
    }
    restauracaoFeita.current = true
    void (async () => {
      const execucao = await db.execucoes.get(pendente.id)
      if (!execucao) {
        setRotaState({ nome: 'home' })
        return
      }
      const ficha = getFicha(execucao.fichaId)
      if (!ficha) {
        setRotaState({ nome: 'home' })
        return
      }
      if (pendente.nome === 'identificacao') {
        if (!podeEditarExecucao(execucao, sessao, execucao.criadaPor).pode) {
          setRotaState({ nome: 'home' })
          return
        }
        setRotaState({ nome: 'identificacao', ficha, execucao })
        return
      }
      if (pendente.nome === 'execucao') {
        if (!podeEditarExecucao(execucao, sessao, execucao.criadaPor).pode) {
          setRotaState({ nome: 'home' })
          return
        }
        setRotaState({ nome: 'execucao', ficha, execucao })
        return
      }
      // 'ficha': registro concluído, aberto em leitura.
      const equipamento = await equipamentoDaExecucao(execucao)
      setRotaState({ nome: 'ficha', ficha, execucao, equipamento })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma vez, na montagem
  }, [])

  const salvarExecucao = async (id: string, status: Execucao['status']) => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) return
    const atualizada: Execucao = { ...execucao, status, atualizadaEm: new Date().toISOString() }
    await db.execucoes.put(atualizada)
    if (status !== 'rascunho') {
      // Equipamento sempre resolvido: mesmo digitado à mão vira um "avulso", para
      // a tela de sucesso conseguir oferecer a próxima manutenção.
      const equipamento =
        (await equipamentoDaExecucao(atualizada)) ?? equipamentoAvulso(atualizada)
      setRota({ nome: 'salvo', execucao: atualizada, equipamento })
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
          podeAlterar={podeEditarExecucao(rota.execucao, sessao, rota.execucao.criadaPor).pode}
          onVoltar={() => setRota({ nome: 'identificacao', ficha: rota.ficha, execucao: rota.execucao })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onSalvar={(status) => void salvarExecucao(rota.execucao.id, status)}
        />
      )

    case 'historico':
      return (
        <TelaHistorico
          podeExcluir={ehAdministrador}
          sessao={sessao}
          onVoltar={() => setRota({ nome: 'home' })}
          onAbrir={(id) => void abrirExecucao(id)}
        />
      )

    case 'cadastros': {
      // Sem sessão de administrador a tela não abre — nem por rota antiga.
      // Exceção: aparelho sem nenhuma pessoa cadastrada. Aí o administrador
      // ainda não existe e, sem esta saída, o app nasce trancado.
      const semNinguem = !ehAdministrador && totalPessoas === 0
      if (!ehAdministrador && !semNinguem) {
        return (
          <TelaHome
            online={online}
            temaEscuro={tema === 'escuro'}
            sessao={sessao}
            ehAdministrador={ehAdministrador}
            onEntrar={() => setIdentificando(true)}
            onSair={sair}
            onNovaExecucaoDoEquipamento={(equip) => void abrirUltimaManutencao(equip)}
            onAbrirExecucao={(id) => void abrirExecucao(id)}
            onVerHistorico={() => setRota({ nome: 'historico' })}
            onVerBackup={() => setRota({ nome: 'backup' })}
            onVerCadastros={() => setRota({ nome: 'cadastros' })}
            onAlternarTema={alternar}
          />
        )
      }
      return (
        <TelaCadastros
          administrador={ehAdministrador ? (sessao?.nome ?? '') : undefined}
          onVoltar={() => setRota({ nome: 'home' })}
        />
      )
    }

    case 'backup':
      return (
        <TelaBackup
          ehAdministrador={ehAdministrador}
          onVoltar={() => setRota({ nome: 'home' })}
          onRestaurado={() => setRota({ nome: 'home' })}
        />
      )

    case 'ficha':
      if (!rota.equipamento) {
        return (
          <TelaHistorico
            podeExcluir={ehAdministrador}
            sessao={sessao}
            onVoltar={() => setRota({ nome: 'home' })}
            onAbrir={(id) => void abrirExecucao(id)}
          />
        )
      }
      return (
        <TelaExecucao
          ficha={rota.ficha}
          execucao={rota.execucao}
          podeAlterar={false}
          onVoltar={() => setRota({ nome: 'historico' })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onSalvar={() => undefined}
          onNovaManutencao={
            rota.equipamento ? () => void novaExecucaoDoEquipamento(rota.equipamento!) : undefined
          }
        />
      )

    case 'salvo':
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
              rota.execucao.status === 'pendente'
                ? 'bg-red-100 text-red-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {rota.execucao.status === 'pendente' ? '!' : '✓'}
          </div>
          <h1
            className={`text-lg font-bold ${
              rota.execucao.status === 'pendente' ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {rota.execucao.status === 'pendente'
              ? 'Salva como pendente'
              : 'Execução concluída'}
          </h1>
          <p className="max-w-xs text-sm text-slate-600">
            {rota.execucao.status === 'pendente'
              ? `${rota.execucao.codigo} foi salva e está marcada como pendente: há medição fora do limite.`
              : `${rota.execucao.codigo} foi salva no aparelho e ficará na fila até sincronizar com o SharePoint.`}
          </p>
          <button
            onClick={() => setRota({ nome: 'home' })}
            className="w-full max-w-xs rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Voltar ao início
          </button>
          <button
            onClick={() => setRota({ nome: 'historico' })}
            className="w-full max-w-xs rounded-xl py-3 text-sm font-semibold text-blue-700"
          >
            Ver histórico
          </button>
        </div>
      )

    default:
      return (
        <>
          {identificando && !sessao && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-sm space-y-2 rounded-2xl bg-white p-4 shadow-2xl">
                <SeletorSessao
                  sessao={sessao}
                  ehAdministrador={ehAdministrador}
                  onEntrar={(nova) => {
                    entrar(nova)
                    setIdentificando(false)
                  }}
                  onSair={() => setIdentificando(false)}
                />
                <button
                  onClick={() => setIdentificando(false)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-600"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <TelaHome
          online={online}
          sessao={sessao}
          onEntrar={() => setIdentificando(true)}
          onSair={sair}
          ehAdministrador={ehAdministrador}
          onNovaExecucaoDoEquipamento={(equip) => void abrirUltimaManutencao(equip)}
          onAbrirExecucao={(id) => void abrirExecucao(id)}
          onVerHistorico={() => setRota({ nome: 'historico' })}
          onVerBackup={() => setRota({ nome: 'backup' })}
          onVerCadastros={() => setRota({ nome: 'cadastros' })}
          onAlternarTema={alternar}
          temaEscuro={tema === 'escuro'}
          />
        </>
      )
  }
}
