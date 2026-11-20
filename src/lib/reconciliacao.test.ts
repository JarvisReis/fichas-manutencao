import { describe, expect, it } from 'vitest'
import { deveRemoverLocal } from './sync'
import type { Execucao } from '../types'

/**
 * Reconciliação de exclusões: quando apagar uma ficha daqui.
 *
 * O sintoma que originou isso: uma ficha concluída foi apagada no servidor e
 * continuou na home deste aparelho, então o mesmo equipamento aparecia
 * "concluído" aqui e "rascunho" no aparelho do técnico.
 *
 * O remédio é fácil de exagerar. Cada teste abaixo é uma forma de apagar
 * trabalho de gente por engano.
 */

const ficha = (extra: Partial<Pick<Execucao, 'id' | 'status' | 'sincronizada'>> = {}) => ({
  id: 'abc',
  status: 'concluida' as const,
  sincronizada: true,
  ...extra,
})

describe('deveRemoverLocal', () => {
  it('ficha fechada que sumiu do servidor é removida', () => {
    expect(deveRemoverLocal(ficha(), new Set(), false)).toBe(true)
  })

  it('ficha que o servidor devolve continua aqui', () => {
    expect(deveRemoverLocal(ficha(), new Set(['abc']), false)).toBe(false)
  })

  it('ficha que ainda não sincronizou nunca é removida', () => {
    expect(deveRemoverLocal(ficha({ sincronizada: false }), new Set(), false)).toBe(false)
  })

  it('rascunho não é removido, mesmo sincronizado', () => {
    // O /historico não devolve rascunho: a ausência dele na resposta não diz nada.
    expect(deveRemoverLocal(ficha({ status: 'rascunho' }), new Set(), false)).toBe(false)
  })

  it('pendente (conforme com não conformidade) segue a mesma regra da concluída', () => {
    expect(deveRemoverLocal(ficha({ status: 'pendente' }), new Set(), false)).toBe(true)
  })

  it('resposta truncada no limite desliga a reconciliação', () => {
    // Com 500 fichas no servidor, a próxima pode estar na página 2.
    expect(deveRemoverLocal(ficha(), new Set(), true)).toBe(false)
  })
})