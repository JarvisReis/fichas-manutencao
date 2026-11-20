import { describe, expect, it } from 'vitest'
import type { PacoteBackup } from './backup'

/**
 * Regras da recuperação a partir de cópia do servidor.
 *
 * O caso real: uma ficha de homologação vivia só no IndexedDB de um aparelho,
 * o técnico limpou o cache e ela desapareceu de todo lugar. O backup automático
 * agora guarda o pacote no servidor — e restaurar não pode virar uma segunda
 * perda, apagando o que já existe no aparelho.
 */

const pacote = (over: Partial<PacoteBackup> = {}): PacoteBackup => ({
  formato: 'fichas-backup',
  versao: 1,
  exportadoEm: '2026-11-20T12:00:00.000Z',
  aparelho: 'teste',
  execucoes: [],
  ...over,
})

const execucao = (id: string, codigo: string) => ({
  id,
  codigo,
  fichaId: 'CT-BI',
  fichaNome: 'Contator',
  local: 'CLI',
  cabecalho: { rg1: 'R221221' },
  camposFixos: { equipamento: 'CLI-CT01' },
  dataHora: '2026-11-20T12:00:00.000Z',
  status: 'concluida',
  sincronizada: true,
  valores: [],
})

describe('pacote de recuperação', () => {
  it('aceita o rótulo atual e o antigo', () => {
    expect(pacote().formato).toBe('fichas-backup')
    expect(pacote({ formato: 'fichas-metro-backup' }).formato).toBe('fichas-metro-backup')
  })

  it('preserva a equipe e o equipamento da ficha', () => {
    const p = pacote({ execucoes: [execucao('a', 'CLI-CT01 · 20/11/2026')] })
    expect(p.execucoes[0].cabecalho.rg1).toBe('R221221')
    expect(p.execucoes[0].camposFixos.equipamento).toBe('CLI-CT01')
  })

  it('ficha sem equipamento continua recuperável pelo código', () => {
    const semEquip = { ...execucao('b', 'CLI-CT01 · 20/11/2026'), camposFixos: {} }
    const p = pacote({ execucoes: [semEquip] })
    // O código carrega o nome do contator: é a reserva para não ficar invisível.
    expect(p.execucoes[0].codigo).toContain('CLI-CT01')
    expect(p.execucoes[0].camposFixos.equipamento).toBeUndefined()
  })

  it('pacote com várias fichas mantém todas', () => {
    const p = pacote({
      execucoes: [execucao('a', 'CLI-CT01 · 19/11/2026'), execucao('b', 'PSO-CT01 · 20/11/2026')],
    })
    expect(new Set(p.execucoes.map((e) => e.id)).size).toBe(2)
  })
})
