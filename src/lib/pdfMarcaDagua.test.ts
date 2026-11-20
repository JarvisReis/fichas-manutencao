import { describe, expect, it } from 'vitest'
import { corpoParaComprimento } from './pdfRelatorio'

/**
 * Tamanho da marca d'água.
 *
 * A conta que decide se a marca cobre 75% da diagonal do A4. Está presa aqui
 * porque errar isso é silencioso: a marca sai na folha, só que menor ou maior do
 * que o pedido. A posição é calibrada por medição no PDF gerado, não por teste.
 */
const DIAGONAL_A4 = Math.hypot(210, 297)
const ALVO = DIAGONAL_A4 * 0.75

describe('corpoParaComprimento', () => {
  it('escala o corpo para o texto cobrir o alvo', () => {
    // Texto que mede 30 mm num corpo 10 precisa de corpo 3× maior para cobrir 90.
    expect(corpoParaComprimento(30, 90)).toBeCloseTo(30, 6)
  })

  it('a proporção se mantém na faixa usada pelo relatório', () => {
    for (const largura of [30, 60, 90, 120]) {
      const corpo = corpoParaComprimento(largura, ALVO)
      expect((largura / 10) * corpo).toBeCloseTo(ALVO, 6)
    }
  })

  it('código curto precisa de corpo grande, e o teto não corta', () => {
    // "CLI-CT01" mede ~15 mm num corpo 10; para 273 mm o corpo passa de 170.
    // O teto já foi 120 e cortava a marca em 231 mm — este teste prende isso.
    const corpo = corpoParaComprimento(15.4, ALVO)
    expect(corpo).toBeGreaterThan(170)
    expect((15.4 / 10) * corpo).toBeCloseTo(ALVO, 6)
  })

  it('código muito comprido não estoura o teto', () => {
    expect(corpoParaComprimento(140, ALVO)).toBeLessThan(30)
  })

  it('largura zero não gera Infinity', () => {
    expect(corpoParaComprimento(0, ALVO)).toBe(10)
    expect(Number.isFinite(corpoParaComprimento(0, ALVO))).toBe(true)
  })
})
