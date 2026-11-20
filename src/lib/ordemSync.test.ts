import { describe, expect, it } from 'vitest'
import { chaveDoEquipamento, semEquipamentosRepetidos } from './cadastros'
import type { Equipamento } from './cadastros'

/**
 * A regra testada aqui é a ordem da sincronização de equipamentos:
 * baixar primeiro, publicar depois — e publicar SÓ o que o servidor não tem.
 *
 * O defeito que ela impede: aparelho com cópia antiga reimprimia a lista local
 * no servidor a cada abertura. Equipamento apagado ressuscitava, duplicata
 * voltava, marca corrigida era desfeita. Foi visto em produção com o
 * CLI-CT01 e com o ANR-CT01.
 */

const equipamento = (nome: string, extra: Partial<Equipamento> = {}): Equipamento =>
  ({ id: `id-${nome}`, nome, fichaId: 'CT-BI', local: 'CLI', ...extra }) as Equipamento

/** Espelha o App: recebe a lista do servidor e a local, devolve o que enviar. */
function oQuePublicar(servidor: Equipamento[], locais: Equipamento[]): Equipamento[] {
  const naoServidor = new Set(servidor.map((e) => chaveDoEquipamento(e)).filter(Boolean))
  return locais.filter((e) => !naoServidor.has(chaveDoEquipamento(e)))
}

describe('ordem da sincronização de equipamentos', () => {
  it('não republica o que o servidor já tem', () => {
    const servidor = [equipamento('CLI-CT01', { serie: 'HPB023' })]
    const locais = [equipamento('CLI-CT01', { serie: '' })]
    expect(oQuePublicar(servidor, locais)).toEqual([])
  })

  it('não ressuscita equipamento apagado no servidor', () => {
    const servidor = [equipamento('CLI-CT01')]
    const locais = [equipamento('CLI-CT01'), equipamento('ANR-CT01')]
    const enviar = oQuePublicar(servidor, locais)
    expect(enviar.map((e) => e.nome)).toEqual(['ANR-CT01'])
  })

  it('não devolve duplicata local ao servidor', () => {
    const servidor = [equipamento('CLI-CT01')]
    const locais = semEquipamentosRepetidos([
      equipamento('CLI-CT01', { id: 'eq-cli-ct01' }),
      equipamento('CLI-CT01', { id: 'fc09c511', serie: 'HPB023' }),
    ])
    expect(oQuePublicar(servidor, locais)).toEqual([])
  })

  it('publica equipamento novo que só existe no aparelho', () => {
    const servidor = [equipamento('CLI-CT01')]
    const locais = [equipamento('CLI-CT01'), equipamento('VMD-CT09')]
    expect(oQuePublicar(servidor, locais).map((e) => e.nome)).toEqual(['VMD-CT09'])
  })

  it('ignora caixa e acento ao comparar com o servidor', () => {
    const servidor = [equipamento('CLI-CT01')]
    const locais = [equipamento('cli-ct01 '), equipamento(' CLI-CT01')]
    expect(oQuePublicar(servidor, locais)).toEqual([])
  })

  it('servidor vazio publica tudo, mas já normalizado', () => {
    const locais = semEquipamentosRepetidos([equipamento('CLI-CT01'), equipamento('CLI-CT01')])
    expect(oQuePublicar([], locais)).toHaveLength(1)
  })
})
