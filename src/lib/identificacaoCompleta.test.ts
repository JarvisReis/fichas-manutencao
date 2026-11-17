import { describe, expect, it } from 'vitest'
import { identificacaoCompleta } from './permissoes'

const base = {
  local: 'Sala 7',
  tipoManutencao: 'P1' as const,
  camposFixos: { rg1: 'R221221', rg2: 'R221043' },
}

describe('identificacaoCompleta', () => {
  it('libera com local, tipo e duas pessoas', () => {
    expect(identificacaoCompleta(base)).toBe(true)
  })

  it('barra sem local', () => {
    expect(identificacaoCompleta({ ...base, local: '   ' })).toBe(false)
  })

  it('barra com uma pessoa só', () => {
    expect(identificacaoCompleta({ ...base, camposFixos: { rg1: 'R221221' } })).toBe(false)
  })

  it('não conta o mesmo RG duas vezes', () => {
    expect(identificacaoCompleta({ ...base, camposFixos: { rg1: 'R221221', rg2: 'R221-221' } })).toBe(
      false,
    )
  })

  it('não conta órgão emissor gravado no lugar do RG', () => {
    expect(identificacaoCompleta({ ...base, camposFixos: { rg1: 'R221221', rg2: 'R SSP' } })).toBe(
      false,
    )
  })

  it('NÃO barra sem tipo: não escolheu vale P1', () => {
    expect(identificacaoCompleta({ ...base, tipoManutencao: undefined })).toBe(true)
  })

  it('só exige marca quando a ficha exige', () => {
    expect(identificacaoCompleta(base, { exigeMarca: true })).toBe(false)
    expect(identificacaoCompleta({ ...base, marca: 'schneider' }, { exigeMarca: true })).toBe(true)
  })
})
