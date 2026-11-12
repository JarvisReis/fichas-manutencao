import type { ItemFicha, Marca, ResultadoItem } from '../types'

export interface Analise {
  resultado: ResultadoItem | 'vazio'
  /** limite efetivo para a marca escolhida, já formatado (ex.: "mín. 30 MΩ") */
  limiteExibido: string
  /** valor numérico efetivo usado na comparação */
  limiteEfetivo: number
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','))

/** Limite aplicável ao item para a marca informada. Itens de marca única ignoram o parâmetro. */
export function limiteDoItem(item: ItemFicha, marca?: Marca): number {
  if (marca === 'schneider' && item.limiteSchneider !== undefined) return item.limiteSchneider
  return item.limite
}

/** Texto do limite como aparece na ficha, considerando a marca. */
export function limiteExibido(item: ItemFicha, marca?: Marca): string {
  const valor = limiteDoItem(item, marca)
  const op = item.direcao === 'max' ? 'máx.' : 'mín.'
  return `${op} ${fmtNum(valor)} ${item.unidade}`
}

/** True quando o item não se aplica à marca escolhida (ex.: Barr. 1 X Barr. 2 só em Merlin Gerin). */
export function itemNaoSeAplica(item: ItemFicha, marca?: Marca): boolean {
  if (!item.apenasMarca) return false
  return item.apenasMarca !== marca
}

/**
 * Interpreta o que o técnico digitou. Aceita vírgula ou ponto decimal, e o
 * símbolo de infinito (ou a palavra) nos itens de isolação.
 */
export function parseValor(item: ItemFicha, bruto: string): number | 'infinito' | null {
  const texto = bruto.trim().toLowerCase()
  if (texto === '') return null
  if (item.aceitaInfinito && (texto === '∞' || texto === 'inf' || texto === 'infinito')) {
    return 'infinito'
  }
  const normalizado = texto.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d*\.?\d+$/.test(normalizado)) return null
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Avalia um item: compara o valor medido com o limite e a direção.
 * Retorna 'vazio' quando ainda não há valor válido digitado.
 */
export function avaliarItem(item: ItemFicha, bruto: string, marca?: Marca): Analise {
  const limiteEfetivo = limiteDoItem(item, marca)
  const exibicao = limiteExibido(item, marca)

  if (itemNaoSeAplica(item, marca)) {
    return { resultado: 'na', limiteExibido: exibicao, limiteEfetivo }
  }

  const valor = parseValor(item, bruto)
  if (valor === null) {
    return { resultado: 'vazio', limiteExibido: exibicao, limiteEfetivo }
  }

  // Infinito é sempre conforme em itens de isolação (limite mínimo).
  if (valor === 'infinito') {
    return { resultado: 'conforme', limiteExibido: exibicao, limiteEfetivo }
  }

  const conforme = item.direcao === 'max' ? valor <= limiteEfetivo : valor >= limiteEfetivo
  return {
    resultado: conforme ? 'conforme' : 'nao_conforme',
    limiteExibido: exibicao,
    limiteEfetivo,
  }
}

/** Pré-formata o valor digitado para exibição no resumo. */
export function valorExibido(item: ItemFicha, bruto: string): string {
  const v = parseValor(item, bruto)
  if (v === null) return '—'
  if (v === 'infinito') return `∞ ${item.unidade}`
  return `${fmtNum(v)} ${item.unidade}`
}
