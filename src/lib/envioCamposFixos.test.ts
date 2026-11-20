import { describe, expect, it } from 'vitest'
import { montarPayload, VERSAO_ENVIO } from './sync'
import type { Execucao } from '../types'

/**
 * Payload de envio: o que sai do aparelho de quem preencheu.
 *
 * O defeito que estes testes prendem apareceu em campo como "a mesma ficha está
 * completa no meu aparelho e faltando no do administrador": a equipe e a série
 * do núcleo retirado ficavam só no IndexedDB, porque o envio mandava apenas o
 * nome do equipamento. Nada quebrava — o servidor aceitava, e a ficha voltava
 * incompleta para todo mundo.
 */

const execucao = (extra: Partial<Execucao> = {}): Execucao => ({
  id: 'exec-1',
  codigo: 'CLI-CT01 · 17–18/11/2026',
  fichaId: 'CT-BI',
  tipoManutencao: 'P2',
  cabecalho: { ped: '123', os1: '456' },
  camposFixos: {
    equipamento: 'CLI-CT01',
    rg1: 'R22104',
    rg2: 'R221221',
    serieRetirado: 'HPB023',
    megaPatrimonio: 'MEG-77',
    torqPatrimonio: 'TOR-12',
  },
  nucleoInstalado: 'HPB005',
  local: 'CLI',
  dataHora: '2026-11-17T04:59:00.000Z',
  dataFim: '2026-11-18T03:59:00.000Z',
  valores: [],
  status: 'concluida',
  sincronizada: false,
  criadaEm: '2026-11-17T04:59:00.000Z',
  atualizadaEm: '2026-11-18T03:59:00.000Z',
  ...extra,
})

describe('montarPayload', () => {
  it('manda os campos fixos inteiros, não só o equipamento', () => {
    const p = montarPayload(execucao(), undefined)
    expect(p.camposFixos).toEqual(execucao().camposFixos)
    expect(p.camposFixos.rg1).toBe('R22104')
    expect(p.camposFixos.rg2).toBe('R221221')
    expect(p.camposFixos.megaPatrimonio).toBe('MEG-77')
  })

  it('manda o cabeçalho como está', () => {
    const p = montarPayload(execucao(), undefined)
    expect(p.cabecalho).toEqual({ ped: '123', os1: '456' })
  })

  it('na P2, a série do núcleo retirado vai no campo próprio', () => {
    const p = montarPayload(execucao(), undefined)
    expect(p.nucleoRetirado).toBe('HPB023')
    expect(p.nucleoInstalado).toBe('HPB005')
  })

  it('na P1 não há núcleo retirado, mesmo que o campo tenha sobrado', () => {
    const p = montarPayload(execucao({ tipoManutencao: 'P1' }), undefined)
    expect(p.nucleoRetirado).toBeUndefined()
  })

  it('a versão do contrato é a 4 (campos fixos completos)', () => {
    expect(VERSAO_ENVIO).toBe(4)
    expect(montarPayload(execucao(), undefined).versao).toBe(4)
  })

  it('o client_id é o id local, para o servidor ser idempotente', () => {
    const p = montarPayload(execucao(), undefined)
    expect(p.client_id).toBe('exec-1')
    expect(p.id).toBe('exec-1')
  })
})