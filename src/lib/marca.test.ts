import { describe, expect, it } from 'vitest'
import { MARCA_CONTATOR, NOME_MARCA, normalizarMarca, type ItemFicha } from '../types'
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
    expect(normalizarMarca('outra marca qualquer')).toBeUndefined()
  })

  it('aceita a marca em qualquer caixa', () => {
    // O próprio app já gravou `Secheron` com maiúscula no servidor. Se isso
    // voltar `undefined`, o item perde o limite próprio sem avisar.
    expect(normalizarMarca('SECHERON')).toBe('secheron')
    expect(normalizarMarca('Secheron')).toBe('secheron')
    expect(normalizarMarca('secheron')).toBe('secheron')
    expect(normalizarMarca('  SECHERON  ')).toBe('secheron')
  })

  it('aceita a marca com acento, como o nome exibido', () => {
    expect(normalizarMarca('Sechéron')).toBe('secheron')
    expect(normalizarMarca('SÉCHERON')).toBe('secheron')
  })

  it('aceita erro de digitação conhecido de cadastro', () => {
    // O equipamento CLI-CT02 foi cadastrado como `Scheron` (sem o "e").
    expect(normalizarMarca('Scheron')).toBe('secheron')
  })

  it('não inventa marca a partir de texto vazio ou espaços', () => {
    expect(normalizarMarca('   ')).toBeUndefined()
    expect(normalizarMarca(null)).toBeUndefined()
  })

  it('o mesmo ponto tem um único limite, independente da marca', () => {
    // Decisão do Ricardo: limite único para todos os contatores. Antes eram
    // 30 µΩ no geral e 15 µΩ só na Sechéron — duas respostas para a mesma
    // medição. Se alguém reintroduzir limite por marca, este teste quebra.
    // O item é montado aqui de propósito: a regra vale para qualquer ficha,
    // não depende de uma ficha específica existir no catálogo.
    const ponto: ItemFicha = {
      id: 'cabos-barr',
      nome: 'Cabos X Barramentos',
      instrumento: 'Microohmímetro',
      unidade: 'µΩ',
      direcao: 'max',
      limite: 15,
    }
    expect(limiteDoItem(ponto, normalizarMarca('schneider'))).toBe(15)
    expect(limiteDoItem(ponto, 'merlin')).toBe(15)
    expect(limiteDoItem(ponto, undefined)).toBe(15)
  })

  it('o catálogo tem exatamente duas fichas: contator e seccionadora', () => {
    // Decisão do Ricardo: só existem estas duas. Ficha extra no catálogo
    // aparece no cadastro de equipamento e confunde quem está em campo.
    expect(FICHAS.map((f) => f.id).sort()).toEqual(['CT-BI', 'SC-BI1'])
  })
})
