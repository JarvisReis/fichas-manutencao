import { describe, expect, it } from 'vitest'
import { rascunhoExpirado, validadeDoRascunho, VALIDADE_RASCUNHO_MS } from './permissoes'

const DIA = 86_400_000
const agora = Date.parse('2026-11-17T12:00:00.000Z')
const emDias = (d: number) => new Date(agora - d * DIA).toISOString()

const rascunho = (diasAtras: number) =>
  ({ status: 'rascunho' as const, atualizadaEm: emDias(diasAtras) })

describe('rascunhoExpirado', () => {
  it('não expira rascunho do mesmo dia', () => {
    expect(rascunhoExpirado(rascunho(0), agora)).toBe(false)
  })

  it('não expira rascunho de 4 dias', () => {
    expect(rascunhoExpirado(rascunho(4), agora)).toBe(false)
  })

  it('expira rascunho de 6 dias', () => {
    expect(rascunhoExpirado(rascunho(6), agora)).toBe(true)
  })

  it('nunca expira ficha concluída, por mais velha que seja', () => {
    expect(rascunhoExpirado({ status: 'concluida', atualizadaEm: emDias(400) }, agora)).toBe(false)
  })

  it('nunca expira ficha pendente', () => {
    expect(rascunhoExpirado({ status: 'pendente', atualizadaEm: emDias(400) }, agora)).toBe(false)
  })

  it('data inválida não apaga nada', () => {
    expect(rascunhoExpirado({ status: 'rascunho', atualizadaEm: 'lixo' }, agora)).toBe(false)
  })
})

describe('validadeDoRascunho', () => {
  it('conta os dias que faltam', () => {
    expect(validadeDoRascunho(rascunho(0), agora)).toBe('5 dias')
    expect(validadeDoRascunho(rascunho(4), agora)).toBe('1 dia')
  })

  it('vencido não tem prazo a mostrar', () => {
    expect(validadeDoRascunho(rascunho(9), agora)).toBe('')
  })

  it('a constante é de 5 dias', () => {
    expect(VALIDADE_RASCUNHO_MS).toBe(5 * DIA)
  })
})
