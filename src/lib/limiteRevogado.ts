import type { ItemFicha, ValorItem } from '../types'

/**
 * A medição foi feita com um limite que não vale mais?
 *
 * O administrador revisa limites de medição — é para isso que o editor de
 * fichas existe. Só que uma ficha antiga continua mostrando "conforme" obtido
 * com a régua antiga, e quem lê o PDF meses depois não tem como saber. Este
 * módulo responde a pergunta comparando o limite gravado no instante da
 * medição com o limite em vigor hoje.
 *
 * Regra de ouro: sem o registro do limite usado, a resposta é sempre
 * "não sei" — nunca inventar revisão. Ficha preenchida antes desta versão não
 * guarda o limite, e acusar mudança nela seria pior do que não avisar.
 */
export interface RevisaoDeLimite {
  revogado: boolean
  limiteUsado?: number
  limiteAtual?: number
  direcaoUsada?: 'max' | 'min'
  direcaoAtual?: 'max' | 'min'
  /** muda quando o limite numérico ou o sentido do limite foram alterados */
  mudouLimite: boolean
  mudouDirecao: boolean
}

export function revisaoDeLimite(
  valor: ValorItem | undefined,
  item: ItemFicha | undefined,
): RevisaoDeLimite {
  const nada: RevisaoDeLimite = { revogado: false, mudouLimite: false, mudouDirecao: false }
  if (!valor || !item) return nada
  if (typeof valor.limiteUsado !== 'number' || !Number.isFinite(valor.limiteUsado)) return nada
  if (typeof item.limite !== 'number' || !Number.isFinite(item.limite)) return nada

  const mudouLimite = valor.limiteUsado !== item.limite
  const mudouDirecao = Boolean(valor.direcaoUsada) && valor.direcaoUsada !== item.direcao

  return {
    revogado: mudouLimite || mudouDirecao,
    limiteUsado: valor.limiteUsado,
    limiteAtual: item.limite,
    direcaoUsada: valor.direcaoUsada,
    direcaoAtual: item.direcao,
    mudouLimite,
    mudouDirecao,
  }
}

/** Texto curto para a tela e para o PDF. Vazio quando nada mudou. */
export function avisoDeRevisao(revisao: RevisaoDeLimite, unidade?: string): string {
  if (!revisao.revogado) return ''
  const u = unidade ? ` ${unidade}` : ''
  if (revisao.mudouLimite) {
    return `Limite revisado depois desta medição: era ${revisao.limiteUsado}${u}, agora é ${revisao.limiteAtual}${u}`
  }
  const sentido = (d: 'max' | 'min' | undefined) => (d === 'min' ? 'mínimo' : 'máximo')
  return `Sentido do limite revisado: era ${sentido(revisao.direcaoUsada)}, agora é ${sentido(revisao.direcaoAtual)}`
}