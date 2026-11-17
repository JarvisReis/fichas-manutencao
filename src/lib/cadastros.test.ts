import { describe, expect, it } from 'vitest'
import { RG_VALIDO, pessoaSelecionavel, rgPareceOrgao, rgValido } from './cadastros'

/*
 * Regressão: o filtro de equipe exigia RG começando com dígito enquanto o
 * formulário de cadastro aceitava qualquer texto. Resultado — RG com prefixo
 * de estado era gravado, aparecia na lista de equipe, e o toque não marcava,
 * sem nenhuma mensagem. Estes casos existem para que as duas telas nunca
 * voltem a discordar.
 */
describe('rgValido', () => {
  it('aceita os formatos que aparecem de fato', () => {
    const aceitos = [
      '12345',
      '12345.6',
      '09233.9',
      '12.345.678-9',
      '12345-6',
      'MG-12345',
      'MG 12.345',
      'SP1234567',
    ]
    for (const rg of aceitos) expect(rgValido(rg), rg).toBe(true)
  })

  it('recusa RG sem número algum', () => {
    expect(rgValido('')).toBe(false)
    expect(rgValido('   ')).toBe(false)
    expect(rgValido('ab')).toBe(false)
    expect(rgValido('MG')).toBe(false)
  })

  it('recusa vazio e nulo', () => {
    expect(rgValido(null)).toBe(false)
    expect(rgValido(undefined)).toBe(false)
  })

  it('ignora espaço nas pontas', () => {
    expect(rgValido('  12345  ')).toBe(true)
  })

  it('recusa excesso de comprimento', () => {
    expect(rgValido('1'.repeat(21))).toBe(false)
  })

  it('a regex exportada concorda com o helper', () => {
    expect(RG_VALIDO.test('MG-12345')).toBe(true)
    expect(RG_VALIDO.test('ab')).toBe(false)
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
