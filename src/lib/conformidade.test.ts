import { describe, expect, it } from 'vitest'
import { avaliarItem, limiteDoItem, limiteExibido, parseValor } from './conformidade'
import type { ItemFicha } from '../types'

const iso30: ItemFicha = {
  id: 't1',
  nome: 'Isolação 30',
  instrumento: 'Medidor de Isolação',
  unidade: 'MΩ',
  direcao: 'min',
  limite: 30,
  aceitaInfinito: true,
}

const res80: ItemFicha = {
  id: 't2',
  nome: 'Resistência 80',
  instrumento: 'Microohmímetro',
  unidade: 'µΩ',
  direcao: 'max',
  limite: 80,
}

const soMG: ItemFicha = {
  id: 't3',
  nome: 'Somente Merlin Gerin',
  instrumento: 'Medidor de Isolação',
  unidade: 'MΩ',
  direcao: 'min',
  limite: 70,
  apenasMarca: 'merlin',
}

const cabos: ItemFicha = {
  id: 't4',
  nome: 'Cabos',
  instrumento: 'Microohmímetro',
  unidade: 'µΩ',
  direcao: 'max',
  limite: 30,
  limiteSchneider: 15,
}

describe('parseValor', () => {
  it('aceita ponto e vírgula decimal', () => {
    expect(parseValor(res80, '12.5')).toBe(12.5)
    expect(parseValor(res80, '12,5')).toBe(12.5)
  })
  it('aceita infinito apenas quando o item permite', () => {
    expect(parseValor(iso30, '∞')).toBe('infinito')
    expect(parseValor(iso30, 'inf')).toBe('infinito')
    expect(parseValor(res80, '∞')).toBeNull()
  })
  it('rejeita texto inválido e vazio', () => {
    expect(parseValor(res80, '')).toBeNull()
    expect(parseValor(res80, 'abc')).toBeNull()
  })
})

describe('limite por marca', () => {
  it('usa limite Schneider quando informado', () => {
    expect(limiteDoItem(cabos, 'schneider')).toBe(15)
    expect(limiteDoItem(cabos, 'merlin')).toBe(30)
  })
  it('formata o limite com operador e unidade', () => {
    expect(limiteExibido(iso30)).toBe('mín. 30 MΩ')
    expect(limiteExibido(res80)).toBe('máx. 80 µΩ')
    expect(limiteExibido(cabos, 'schneider')).toBe('máx. 15 µΩ')
  })
})

describe('avaliarItem — limite máximo', () => {
  it('conforme abaixo e no limite', () => {
    expect(avaliarItem(res80, '23').resultado).toBe('conforme')
    expect(avaliarItem(res80, '80').resultado).toBe('conforme')
  })
  it('não conforme acima do limite', () => {
    expect(avaliarItem(res80, '81').resultado).toBe('nao_conforme')
  })
})

describe('avaliarItem — limite mínimo', () => {
  it('conforme acima e no limite', () => {
    expect(avaliarItem(iso30, '30').resultado).toBe('conforme')
    expect(avaliarItem(iso30, '450').resultado).toBe('conforme')
  })
  it('não conforme abaixo do limite', () => {
    expect(avaliarItem(iso30, '29.9').resultado).toBe('nao_conforme')
  })
  it('infinito é conforme', () => {
    expect(avaliarItem(iso30, '∞').resultado).toBe('conforme')
  })
})

describe('avaliarItem — vazio e N/A', () => {
  it('sem valor retorna vazio', () => {
    expect(avaliarItem(iso30, '').resultado).toBe('vazio')
  })
  it('item exclusivo de Merlin Gerin é N/A em Schneider', () => {
    expect(avaliarItem(soMG, '500', 'schneider').resultado).toBe('na')
    expect(avaliarItem(soMG, '500', 'merlin').resultado).toBe('conforme')
  })
  it('aplica limite de Schneider na comparação', () => {
    expect(avaliarItem(cabos, '20', 'schneider').resultado).toBe('nao_conforme')
    expect(avaliarItem(cabos, '20', 'merlin').resultado).toBe('conforme')
  })
})
