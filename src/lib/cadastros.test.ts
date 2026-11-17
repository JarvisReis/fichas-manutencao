import { describe, expect, it } from 'vitest'
import { RG_VALIDO, pessoaSelecionavel, rgPareceOrgao, rgValido } from './cadastros'

/*
 * Regra do Metrô: RG é o número funcional, só dígitos, de 5 a 6 caracteres.
 * Antes o campo aceitava texto livre e o filtro de equipe descartava em
 * silêncio — o registro aparecia na lista, o toque não marcava e nada
 * explicava. Agora cadastro e filtro usam a MESMA regra, e o campo nem
 * deixa digitar o que ela recusa.
 */
describe('rgValido', () => {
  it('aceita de 5 a 6 dígitos', () => {
    for (const rg of ['12345', '221221', '00001']) {
      expect(rgValido(rg), rg).toBe(true)
    }
  })

  it('recusa curto demais', () => {
    for (const rg of ['', '   ', '1', '123', '1234']) {
      expect(rgValido(rg), rg).toBe(false)
    }
  })

  it('recusa longo demais', () => {
    expect(rgValido('1234567')).toBe(false)
    expect(rgValido('1'.repeat(21))).toBe(false)
  })

  it('recusa letra, ponto, hífen, barra e espaço', () => {
    for (const rg of ['22122A', '09233.9', '12345-6', 'MG-12345', 'SP1234567', '12 345']) {
      expect(rgValido(rg), rg).toBe(false)
    }
  })

  it('recusa vazio e nulo', () => {
    expect(rgValido(null)).toBe(false)
    expect(rgValido(undefined)).toBe(false)
  })

  it('a regex exportada concorda com o helper', () => {
    expect(RG_VALIDO.test('221221')).toBe(true)
    expect(RG_VALIDO.test('MG-12345')).toBe(false)
    expect(RG_VALIDO.test('1234')).toBe(false)
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
