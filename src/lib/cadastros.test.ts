import { describe, expect, it } from 'vitest'
import { RG_VALIDO, rgValido } from './cadastros'

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
