/**
 * Quais blocos a ficha mostra, e qual deles abre primeiro.
 *
 * A ficha de papel é dividida em blocos, e em campo o técnico preenche um bloco
 * por vez — sem rolar a tela inteira para achar onde parou. O mesmo conjunto de
 * blocos vale para **toda ficha que se está preenchendo**: a que nasce na hora e
 * a que foi reaberta para corrigir. Ficha concluída não usa isto: ela é
 * documento e sai inteira, de cima a baixo.
 *
 * Ficou aqui, fora do componente, porque a regra é chata de acertar e cara de
 * testar na tela: cada bloco depende de um dado diferente (equipe preenchida,
 * ficha de contator, instrumentos anotados).
 */
import type { DefinicaoFicha } from '../types'

export type Topico = 'identificacao' | 'equipe' | 'medicoes' | 'nucleo' | 'instrumentos'

export interface TopicoDaFicha {
  id: Topico
  rotulo: string
}

/** Tópico que sempre existe, e para onde qualquer pedido inválido cai. */
export const TOPICO_PADRAO: Topico = 'medicoes'

export interface EntradaTopicos {
  ficha: DefinicaoFicha
}

/**
 * Só o contator tem os campos de número de série do núcleo — é o que a P2 troca.
 *
 * Quem decide é a **ficha**, não o dado gravado: olhar `nucleoInstalado` fazia a
 * seccionadora mostrar o bloco quando o equipamento vinha de uma ficha antiga.
 */
export function fichaTemNucleo(ficha: DefinicaoFicha): boolean {
  return ficha.camposFixos.some((c) => c.id === 'serieInstalado' || c.id === 'serieRetirado')
}

/**
 * Blocos na ordem em que aparecem.
 *
 * Equipe e Instrumentos entram **sempre** na ficha em preenchimento, mesmo
 * vazios. A versão anterior os escondia até ter conteúdo, e o efeito em campo
 * foi o oposto do pretendido: a aba desaparecia no meio do preenchimento (o
 * técnico limpava o último RG e o bloco sumia junto com o que ele estava
 * digitando). Bloco que aparece e desaparece é pior que bloco vazio — vazio o
 * técnico vê que falta preencher.
 *
 * Núcleo continua condicional, mas por outro motivo: não é conteúdo, é a
 * própria ficha. Seccionadora não tem núcleo, e aí a aba nunca deve existir.
 */
export function topicosDaFicha({ ficha }: EntradaTopicos): TopicoDaFicha[] {
  return [
    { id: 'identificacao', rotulo: 'Identificação' },
    { id: 'equipe' as Topico, rotulo: 'Equipe' },
    ...(fichaTemNucleo(ficha) ? [{ id: 'nucleo' as Topico, rotulo: 'Núcleo' }] : []),
    { id: 'instrumentos' as Topico, rotulo: 'Instrumentos' },
    // Medições é o destino, não uma etapa: fica por último e é o que o
    // "Próximo" da última aba de identificação abre.
    { id: 'medicoes', rotulo: 'Medições' },
  ]
}

/**
 * Tópico efetivamente exibido.
 *
 * O pedido pode não existir nesta ficha (abriu em Núcleo e a ficha é de
 * seccionadora). Nesse caso cai em Medições, que sempre existe.
 */
export function tipoEmVigor(topicos: TopicoDaFicha[], pedido: Topico | null): Topico {
  if (pedido && topicos.some((t) => t.id === pedido)) return pedido
  return TOPICO_PADRAO
}

/**
 * Se a ficha está em preenchimento (mostra blocos) ou concluída (mostra tudo).
 *
 * `podeAlterar` é a única entrada de propósito: ficha concluída é documento,
 * e nada nela deve ser editável depois de concluir.
 */
export function estaEmModoRelatorio(podeAlterar: boolean): boolean {
  return !podeAlterar
}
