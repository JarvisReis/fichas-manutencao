import { useCallback, useEffect, useState } from 'react'

export type Tema = 'claro' | 'escuro'

const CHAVE = 'fichas:tema'

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE)
  if (salvo === 'claro' || salvo === 'escuro') return salvo
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

/**
 * Tema claro/escuro aplicado no <html>. O valor inicial vem do sistema na
 * primeira abertura e depois fica preso à escolha do técnico.
 */
export function useTema() {
  const [tema, setTema] = useState<Tema>(() => {
    try {
      return temaInicial()
    } catch {
      return 'claro'
    }
  })

  useEffect(() => {
    const raiz = document.documentElement
    raiz.classList.toggle('tema-escuro', tema === 'escuro')
    try {
      localStorage.setItem(CHAVE, tema)
    } catch {
      /* modo privado: segue sem persistir */
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', tema === 'escuro' ? '#0b1220' : '#eef2f7')
  }, [tema])

  const alternar = useCallback(() => {
    setTema((atual) => (atual === 'claro' ? 'escuro' : 'claro'))
  }, [])

  return { tema, alternar }
}
