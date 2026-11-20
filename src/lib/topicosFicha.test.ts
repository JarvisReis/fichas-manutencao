import { describe, expect, it } from 'vitest'
import {
  estaEmModoRelatorio,
  fichaTemNucleo,
  tipoEmVigor,
  topicosDaFicha,
} from './topicosFicha'
import { FICHAS } from '../config/fichas'
import type { DefinicaoFicha } from '../types'

/**
 * Blocos da ficha e modo de exibição.
 *
 * Dois pedidos do Ricardo ficam presos aqui:
 * 1. ficha **nova** e ficha **reaberta para corrigir** têm os mesmos blocos;
 * 2. ficha concluída não se altera.
 *
 * E um terceiro, que veio de um defeito em campo: as abas Equipe e Instrumentos
 * apareciam e desapareciam conforme o preenchimento, e o técnico perdia o que
 * estava digitando quando o bloco sumia. Agora existem sempre.
 */
const contator = FICHAS.find((f) => f.id === 'CT-BI')!
const seccionadora = FICHAS.find((f) => f.id === 'SC-BI1')!

describe('topicosDaFicha', () => {
  it('contator mostra as cinco abas, com Medições por último', () => {
    // Medições é destino, não etapa: fica no fim e é o que o Próximo da
    // última aba de identificação abre.
    expect(topicosDaFicha({ ficha: contator }).map((x) => x.id)).toEqual([
      'identificacao',
      'equipe',
      'nucleo',
      'instrumentos',
      'medicoes',
    ])
  })

  it('Medições é sempre a última aba', () => {
    for (const f of [contator, seccionadora]) {
      const ids = topicosDaFicha({ ficha: f }).map((x) => x.id)
      expect(ids[ids.length - 1]).toBe('medicoes')
    }
  })

  it('Equipe vem antes de Medições', () => {
    const ids = topicosDaFicha({ ficha: contator }).map((x) => x.id)
    expect(ids.indexOf('equipe')).toBeLessThan(ids.indexOf('medicoes'))
  })

  it('Equipe e Instrumentos existem mesmo vazios', () => {
    // Era este o defeito: a aba só nascia com dado gravado.
    const ids = topicosDaFicha({ ficha: contator }).map((x) => x.id)
    expect(ids).toContain('equipe')
    expect(ids).toContain('instrumentos')
  })

  it('seccionadora não tem bloco Núcleo', () => {
    const ids = topicosDaFicha({ ficha: seccionadora }).map((x) => x.id)
    expect(ids).not.toContain('nucleo')
    expect(ids).toEqual(['identificacao', 'equipe', 'instrumentos', 'medicoes'])
  })

  it('Medições sempre existe, em qualquer ficha', () => {
    for (const f of [contator, seccionadora]) {
      expect(topicosDaFicha({ ficha: f }).map((x) => x.id)).toContain('medicoes')
    }
  })
})

describe('fichaTemNucleo', () => {
  it('contator tem, seccionadora não', () => {
    expect(fichaTemNucleo(contator)).toBe(true)
    expect(fichaTemNucleo(seccionadora)).toBe(false)
  })

  it('decide pela ficha, não pelo dado gravado', () => {
    // Seccionadora com núcleoInstalado preenchido (ficha antiga) não mostra o
    // bloco: o campo nem existe nesse modelo.
    const comLixo = { ...seccionadora, nucleoInstalado: 'HPB001' } as DefinicaoFicha
    expect(fichaTemNucleo(comLixo)).toBe(false)
  })
})

describe('tipoEmVigor', () => {
  const topicos = topicosDaFicha({ ficha: contator })

  it('sem pedido cai em Medições', () => {
    expect(tipoEmVigor(topicos, null)).toBe('medicoes')
  })

  it('pedido existente é respeitado', () => {
    expect(tipoEmVigor(topicos, 'nucleo')).toBe('nucleo')
    expect(tipoEmVigor(topicos, 'equipe')).toBe('equipe')
  })

  it('pedido que não existe na ficha cai em Medições', () => {
    const daSeccionadora = topicosDaFicha({ ficha: seccionadora })
    expect(tipoEmVigor(daSeccionadora, 'nucleo')).toBe('medicoes')
  })
})

describe('estaEmModoRelatorio', () => {
  it('quem pode alterar preenche por blocos', () => {
    expect(estaEmModoRelatorio(true)).toBe(false)
  })

  it('ficha concluída sai inteira e não se altera', () => {
    expect(estaEmModoRelatorio(false)).toBe(true)
  })
})
