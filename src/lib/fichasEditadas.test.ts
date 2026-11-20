import { describe, expect, it } from 'vitest'
import { fichaEmVigor, fichasEmVigor, deveAplicarRemoto } from './fichasEditadas'
import { FICHAS } from '../config/fichas'
import type { DefinicaoFicha, ItemFicha } from '../types'

/**
 * Ficha em vigor = padrão do código + ajuste do administrador.
 *
 * O risco de guardar ficha copiada no banco é o código evoluir e a cópia antiga
 * esconder a novidade. Estes testes prendem o comportamento que evita isso.
 */

const padrao = FICHAS[0]

const itemExtra = (id: string): ItemFicha => ({
  id,
  nome: 'Ponto novo',
  instrumento: 'Microohmímetro',
  unidade: 'µΩ',
  direcao: 'max',
  limite: 10,
})

describe('fichaEmVigor', () => {
  it('sem ajuste, devolve exatamente a ficha do código', () => {
    expect(fichaEmVigor(padrao)).toEqual(padrao)
  })

  it('ajuste só dos itens mantém nome e demais campos do código', () => {
    const itens = [itemExtra('x1')]
    const ficha = fichaEmVigor(padrao, { itens })
    expect(ficha.itens).toEqual(itens)
    expect(ficha.nome).toBe(padrao.nome)
    expect(ficha.prefixo).toBe(padrao.prefixo)
    expect(ficha.camposFixos).toEqual(padrao.camposFixos)
  })

  it('troca o nome quando o ajuste traz nome', () => {
    const ficha = fichaEmVigor(padrao, { nome: 'Contator — revisão 2026' })
    expect(ficha.nome).toBe('Contator — revisão 2026')
    expect(ficha.itens).toEqual(padrao.itens)
  })

  it('tipo de manutenção vazio não apaga a navegação da ficha', () => {
    const ficha = fichaEmVigor(padrao, { tiposManutencao: [] })
    expect(ficha.tiposManutencao).toEqual(padrao.tiposManutencao)
  })

  it('não muta a definição padrão', () => {
    const antes: DefinicaoFicha = JSON.parse(JSON.stringify(padrao))
    fichaEmVigor(padrao, { nome: 'outro', itens: [itemExtra('y')] })
    expect(padrao).toEqual(antes)
  })

  it('fichasEmVigor aplica o ajuste só na ficha do id certo', () => {
    const lista = fichasEmVigor({ [padrao.id]: { nome: 'Ajustada' } })
    const comAjuste = lista.find((f) => f.id === padrao.id)
    const semAjuste = lista.find((f) => f.id !== padrao.id)
    expect(comAjuste?.nome).toBe('Ajustada')
    expect(semAjuste?.nome).toBe(FICHAS.find((f) => f.id === semAjuste?.id)?.nome)
  })
})

describe('limite ajustado vale na avaliação', () => {
  it('o item editado é o que a tela vai usar', () => {
    const itens = padrao.itens.map((it, i) =>
      i === 0 ? { ...it, limite: 5, direcao: 'max' as const } : it,
    )
    const ficha = fichaEmVigor(padrao, { itens })
    expect(ficha.itens[0].limite).toBe(5)
    // Os demais pontos continuam intactos.
    expect(ficha.itens.slice(1)).toEqual(padrao.itens.slice(1))
  })
})

/**
 * A versão publicada decide se o aparelho baixa a ficha do servidor.
 *
 * Errar para o lado de baixar demais reescreve o banco local sem motivo; errar
 * para o lado de baixar de menos deixa o técnico medindo por limite revogado.
 * Por isso os casos de borda estão presos aqui.
 */
describe('deveAplicarRemoto', () => {
  const t1 = '2026-11-20T12:00:00.000Z'
  const t2 = '2026-11-20T12:05:00.000Z'

  it('servidor sem ajuste publicado não apaga o ajuste local', () => {
    expect(deveAplicarRemoto(t1, null)).toBe(false)
    expect(deveAplicarRemoto(null, null)).toBe(false)
    expect(deveAplicarRemoto(t1, undefined)).toBe(false)
  })

  it('primeira vez (nada aplicado) baixa', () => {
    expect(deveAplicarRemoto(null, t1)).toBe(true)
  })

  it('versão remota mais nova baixa', () => {
    expect(deveAplicarRemoto(t1, t2)).toBe(true)
  })

  it('mesma versão não baixa de novo', () => {
    expect(deveAplicarRemoto(t1, t1)).toBe(false)
  })

  it('versão remota mais antiga não rebaixa o aparelho', () => {
    expect(deveAplicarRemoto(t2, t1)).toBe(false)
  })

  it('carimbo inválido é ignorado em vez de virar NaN', () => {
    expect(deveAplicarRemoto(t1, 'ontem')).toBe(false)
    expect(deveAplicarRemoto('lixo', t1)).toBe(true)
  })
})
