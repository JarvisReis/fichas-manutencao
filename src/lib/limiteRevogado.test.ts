import { describe, expect, it } from 'vitest'
import { avisoDeRevisao, revisaoDeLimite } from './limiteRevogado'
import type { ItemFicha, ValorItem } from '../types'

/**
 * Régua revista depois da medição.
 *
 * O caso que estes testes protegem é o silencioso: ficha medida com limite 15,
 * limite revisado para 12, e o PDF meses depois ainda dizendo "conforme". Quem
 * audita precisa ver que a régua mudou — e, no sentido oposto, não pode ver
 * alarme onde nada mudou.
 */

const item = (limite: number, direcao: 'max' | 'min' = 'max'): ItemFicha => ({
  id: 'p1',
  nome: 'Resistência de contato',
  instrumento: 'Microohmímetro',
  unidade: 'µΩ',
  direcao,
  limite,
})

const valor = (extra: Partial<ValorItem> = {}): ValorItem => ({
  itemId: 'p1',
  valor: '14',
  limiteUsado: 15,
  direcaoUsada: 'max',
  unidadeUsada: 'µΩ',
  ...extra,
})

describe('revisaoDeLimite', () => {
  it('limite igual ao usado não acusa revisão', () => {
    const r = revisaoDeLimite(valor(), item(15))
    expect(r.revogado).toBe(false)
    expect(avisoDeRevisao(r, 'µΩ')).toBe('')
  })

  it('limite apertado depois da medição é acusado', () => {
    const r = revisaoDeLimite(valor(), item(12))
    expect(r.revogado).toBe(true)
    expect(r.mudouLimite).toBe(true)
    expect(r.limiteUsado).toBe(15)
    expect(r.limiteAtual).toBe(12)
    expect(avisoDeRevisao(r, 'µΩ')).toContain('era 15')
    expect(avisoDeRevisao(r, 'µΩ')).toContain('agora é 12')
  })

  it('limite afrouxado também é revisão', () => {
    expect(revisaoDeLimite(valor(), item(20)).revogado).toBe(true)
  })

  it('inversão do sentido do limite é revisão mesmo com número igual', () => {
    const r = revisaoDeLimite(valor(), item(15, 'min'))
    expect(r.revogado).toBe(true)
    expect(r.mudouLimite).toBe(false)
    expect(r.mudouDirecao).toBe(true)
    expect(avisoDeRevisao(r)).toContain('mínimo')
  })

  it('ficha antiga sem limite gravado não afirma nada', () => {
    const antigo = { itemId: 'p1', valor: '14' } as ValorItem
    expect(revisaoDeLimite(antigo, item(12)).revogado).toBe(false)
  })

  it('valor ou item ausente não explode nem acusa', () => {
    expect(revisaoDeLimite(undefined, item(12)).revogado).toBe(false)
    expect(revisaoDeLimite(valor(), undefined).revogado).toBe(false)
  })

  it('limite não numérico (texto livre na ficha) é ignorado', () => {
    const itemEstranho = { ...item(12), limite: Number.NaN }
    expect(revisaoDeLimite(valor(), itemEstranho).revogado).toBe(false)
  })
})