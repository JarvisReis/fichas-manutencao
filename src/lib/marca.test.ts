import { describe, expect, it } from 'vitest'
import { MARCA_CONTATOR, NOME_MARCA, normalizarMarca } from '../types'
import { limiteDoItem } from './conformidade'
import { FICHAS } from '../config/fichas'

describe('marca única: Sechéron', () => {
  it('a chave interna é secheron', () => {
    expect(MARCA_CONTATOR).toBe('secheron')
    expect(NOME_MARCA[MARCA_CONTATOR]).toBe('Sechéron')
  })

  it('lê a chave antiga `schneider` sem perder a marca', () => {
    // Execução gravada antes da renomeação: se voltar undefined, o limite
    // passa a ser o padrão (30 µΩ) em vez do próprio (15 µΩ) — erro mudo.
    expect(normalizarMarca('schneider')).toBe('secheron')
  })

  it('preserva merlin, que é histórico de verdade', () => {
    expect(normalizarMarca('merlin')).toBe('merlin')
  })

  it('ignora lixo e vazio', () => {
    expect(normalizarMarca('')).toBeUndefined()
    expect(normalizarMarca(undefined)).toBeUndefined()
    expect(normalizarMarca('SECHERON')).toBeUndefined()
  })

  it('limite próprio continua valendo depois de normalizar', () => {
    const ficha = FICHAS.find((f) => f.id === 'CT-FICHA')!
    const cabos = ficha.itens.find((i) => i.id === 'cabos-barr')!
    expect(limiteDoItem(cabos, normalizarMarca('schneider'))).toBe(15)
    expect(limiteDoItem(cabos, 'merlin')).toBe(30)
  })
})
