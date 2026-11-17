import { describe, expect, it } from 'vitest'
import { rgEmUso, rgValido } from './cadastros'
import type { Pessoa } from './cadastros'

const pessoa = (id: string, nome: string, rg: string, ativo = true): Pessoa => ({
  id,
  nome,
  rg,
  nivel: 'usuario',
  ativo,
})

const elenco = [
  pessoa('p1', 'Ricardo Reis', 'R221221'),
  pessoa('p2', 'Luciano Severino', 'R221043'),
  pessoa('p3', 'Inativo Antigo', 'R900001', false),
]

describe('RG único por funcionário', () => {
  it('aceita RG livre', () => {
    expect(rgEmUso('R300300', elenco)).toBeNull()
  })

  it('recusa RG de outra pessoa e diz de quem é', () => {
    expect(rgEmUso('R221221', elenco)?.nome).toBe('Ricardo Reis')
  })

  it('na edição não acusa a própria pessoa', () => {
    expect(rgEmUso('R221221', elenco, 'p1')).toBeNull()
  })

  it('pega o mesmo RG com zero à esquerda', () => {
    // R0221221 (7 dígitos) não é um RG válido: a entrada nem deixa digitar.
    // O zero à esquerda só pode sobrar de cadastro antigo com 6 dígitos,
    // ex.: R022122 vs R22122 — mesma pessoa, mesmo número.
    const antigos = [pessoa('p9', 'Cadastro Antigo', 'R022122')]
    expect(rgEmUso('R22122', antigos)?.nome).toBe('Cadastro Antigo')
  })

  it('ignora caixa e espaço em volta', () => {
    expect(rgEmUso('  r221221 ', elenco)?.nome).toBe('Ricardo Reis')
  })

  it('conta RG de funcionário inativo: desativar não devolve o número', () => {
    expect(rgEmUso('R900001', elenco)?.nome).toBe('Inativo Antigo')
  })

  it('RG com formato inválido não é comparado', () => {
    expect(rgEmUso('', elenco)).toBeNull()
    expect(rgEmUso('12345', elenco)).toBeNull()
    expect(rgValido('R221221')).toBe(true)
  })

  it('cadastro vazio aceita qualquer RG válido', () => {
    expect(rgEmUso('R221221', [])).toBeNull()
  })
})
