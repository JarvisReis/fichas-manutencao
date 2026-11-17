import { describe, expect, it } from 'vitest'
import { RG_VALIDO, pessoaSelecionavel, rgPareceOrgao, rgValido } from './cadastros'

/*
 * Regra do Metrô: identificação interna, sempre `R` + 5 ou 6 dígitos
 * (`R221221`, `R22104`). Não é RG civil — é o registro funcional da empresa.
 * O prefixo é obrigatório: sem ele o campo vira texto livre e foi assim que
 * "R SSP" (órgão emissor) entrou no lugar de um número.
 */
describe('rgValido', () => {
  it('aceita R + 5 ou 6 dígitos', () => {
    for (const rg of ['R12345', 'R221221', 'R00001', 'r221221']) {
      expect(rgValido(rg), rg).toBe(true)
    }
  })

  it('aceita espaço nas pontas', () => {
    expect(rgValido('  R221221  ')).toBe(true)
  })

  it('recusa sem o prefixo R', () => {
    for (const rg of ['12345', '221221', '123456']) {
      expect(rgValido(rg), rg).toBe(false)
    }
  })

  it('recusa menos de 5 ou mais de 6 dígitos', () => {
    for (const rg of ['R1', 'R123', 'R1234', 'R1234567']) {
      expect(rgValido(rg), rg).toBe(false)
    }
  })

  it('recusa R sozinho', () => {
    expect(rgValido('R')).toBe(false)
    expect(rgValido('')).toBe(false)
    expect(rgValido(null)).toBe(false)
    expect(rgValido(undefined)).toBe(false)
  })

  it('recusa separador dentro do número', () => {
    for (const rg of ['R22-1221', 'R22.1221', 'R 221221', 'R22 1221']) {
      expect(rgValido(rg), rg).toBe(false)
    }
  })

  it('a regex exportada concorda com o helper', () => {
    expect(RG_VALIDO.test('R221221')).toBe(true)
    expect(RG_VALIDO.test('221221')).toBe(false)
    expect(RG_VALIDO.test('R SSP')).toBe(false)
  })
})

/*
 * Regressão: o campo RG é texto livre, e o técnico às vezes digita o órgão
 * emissor ("R SSP") em vez do número. O registro entrava na lista de equipe
 * como se fosse funcionário, e a busca por "221043" trazia junto o "R221043".
 */
describe('rgPareceOrgao', () => {
  it('reconhece abreviação de órgão emissor', () => {
    expect(rgPareceOrgao('R SSP')).toBe(true)
    expect(rgPareceOrgao('R SP')).toBe(true)
    expect(rgPareceOrgao('  r sp  ')).toBe(true)
  })

  it('não confunde RG numérico com órgão', () => {
    expect(rgPareceOrgao('221221')).toBe(false)
    expect(rgPareceOrgao('221043')).toBe(false)
    expect(rgPareceOrgao('R221043')).toBe(false)
    expect(rgPareceOrgao('MG-12345')).toBe(false)
  })
})

describe('pessoaSelecionavel', () => {
  const base = { id: '1', nome: 'Luciano Severino', rg: '221043', nivel: 'usuario', ativo: true } as const

  it('aceita funcionário ativo com nome e RG', () => {
    expect(pessoaSelecionavel({ ...base, nivel: 'usuario' })).toBe(true)
  })

  it('recusa registro inativo', () => {
    expect(pessoaSelecionavel({ ...base, nivel: 'usuario', ativo: false })).toBe(false)
  })

  it('recusa registro sem nome', () => {
    expect(pessoaSelecionavel({ ...base, nome: '   ', nivel: 'usuario' })).toBe(false)
  })

  it('recusa RG que é órgão emissor', () => {
    expect(pessoaSelecionavel({ ...base, rg: 'R SSP', nivel: 'usuario' })).toBe(false)
  })
})
