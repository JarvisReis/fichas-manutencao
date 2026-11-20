import { describe, expect, it } from 'vitest'
import { chaveDoEquipamento, semEquipamentosRepetidos, type Equipamento } from './cadastros'

const cli1: Equipamento = {
  id: 'eq-cli-ct01',
  nome: 'CLI-CT01',
  fichaId: 'CT-BI',
  local: 'CLI',
  marca: 'secheron',
}

const cli2: Equipamento = {
  id: 'fc09c511-e9a4-4f6f-9a4d-8267bc912bec',
  nome: 'CLI-CT01',
  fichaId: 'CT-BI',
  local: 'CLI',
  marca: 'secheron',
  serie: 'HPB023',
}

const outro: Equipamento = {
  id: 'eq-anr-ct01',
  nome: 'ANR-CT01',
  fichaId: 'CT-BI',
  local: 'ANR',
}

describe('equipamento não se repete na lista', () => {
  it('a identidade é o nome, não o id', () => {
    // Foi exatamente assim que o CLI-CT01 ficou duplicado: mesmo nome, ids
    // diferentes (um do cadastro antigo, outro criado depois pelo servidor).
    expect(chaveDoEquipamento(cli1)).toBe(chaveDoEquipamento(cli2))
    expect(chaveDoEquipamento(cli1)).toBe('cli-ct01')
  })

  it('dois cadastros com o mesmo nome viram um', () => {
    expect(semEquipamentosRepetidos([cli1, cli2])).toHaveLength(1)
  })

  it('mantém a versão mais recente, que é a que estava no fim', () => {
    // O administrador acabou de salvar: a última da lista é a boa.
    const [unico] = semEquipamentosRepetidos([cli1, cli2])
    expect(unico.id).toBe('fc09c511-e9a4-4f6f-9a4d-8267bc912bec')
    expect(unico.serie).toBe('HPB023')
  })

  it('não mexe em equipamentos diferentes', () => {
    expect(semEquipamentosRepetidos([cli1, outro])).toHaveLength(2)
  })

  it('ignora caixa, acento e espaços ao comparar', () => {
    const variante = { ...cli1, id: 'x', nome: '  cli-ct01  ' }
    expect(semEquipamentosRepetidos([cli1, variante])).toHaveLength(1)
  })

  it('preserva cadastro sem nome, que ainda precisa ser corrigido', () => {
    // Descartar sumiria com o registro e esconderia o erro de cadastro.
    const semNome = { ...cli1, id: 'y', nome: '   ' }
    expect(semEquipamentosRepetidos([cli1, semNome])).toHaveLength(2)
  })

  it('lista vazia continua vazia', () => {
    expect(semEquipamentosRepetidos([])).toEqual([])
  })
})
