import { useCallback, useEffect, useState } from 'react'
import { lerToken } from './auth'

/**
 * Sessão de trabalho no aparelho.
 *
 * O app é usado por uma equipe em um celular compartilhado: quem está logado
 * define o que pode ser feito — administrador mantém cadastros e apaga
 * execuções; usuário só executa e vê histórico.
 *
 * A sessão é gravada em localStorage e vale só neste aparelho.
 */

export type NivelSessao = 'administrador' | 'usuario'

export interface Sessao {
  pessoaId: string
  nome: string
  rg: string
  nivel: NivelSessao
}

const CHAVE = 'fichas:sessao'

export function lerSessao(): Sessao | null {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return null
    const dados = JSON.parse(bruto) as Sessao
    if (!dados?.pessoaId || !dados?.nivel) return null
    return dados
  } catch {
    return null
  }
}

export function gravarSessao(sessao: Sessao | null) {
  try {
    if (sessao) localStorage.setItem(CHAVE, JSON.stringify(sessao))
    else localStorage.removeItem(CHAVE)
  } catch {
    /* localStorage indisponível */
  }
}

/** Hook de sessão: mantém o estado sincronizado com o localStorage. */
export function useSessao() {
  const [sessao, setSessao] = useState<Sessao | null>(() => {
    const retrato = lerSessao()
    if (retrato && !lerToken()) {
      gravarSessao(null)
      return null
    }
    return retrato
  })

  const entrar = useCallback((nova: Sessao) => {
    gravarSessao(nova)
    setSessao(nova)
  }, [])

  const sair = useCallback(() => {
    gravarSessao(null)
    setSessao(null)
  }, [])

  /**
   * Sessão restaurada precisa de token por trás.
   *
   * `fichas:sessao` é um retrato de nome/RG/nível no localStorage — sozinho,
   * ele faria o app abrir como administrador sem senha. A autoridade é o token
   * do Supabase.
   *
   * A checagem mora no estado inicial, e não num efeito: com StrictMode o
   * efeito roda duas vezes e a segunda execução apagava a sessão que o login
   * tinha acabado de gravar — era isso que fazia o app "fechar" ao entrar.
   *
   * Na prática, o que se limpa aqui é um retrato órfão: sessão salva sem token
   * (alguém limpou o armazenamento). Token vencido é derrubado pelo servidor
   * na primeira chamada, que é onde a checagem vale de verdade.
   */
  useEffect(() => {
    const aoTrocarAba = () => setSessao(lerSessao())
    window.addEventListener('storage', aoTrocarAba)

    return () => window.removeEventListener('storage', aoTrocarAba)
  }, [])

  return {
    sessao,
    entrar,
    sair,
    ehAdministrador: sessao?.nivel === 'administrador',
  }
}
