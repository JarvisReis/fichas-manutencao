import { db } from './db'
import { FICHAS } from '../config/fichas'
import type { DefinicaoFicha } from '../types'

/**
 * Fichas ajustadas pelo administrador.
 *
 * `src/config/fichas.ts` é a transcrição da ficha de papel — continua sendo o
 * ponto de partida e o que vale quando ninguém mexeu. Mas o formulário muda:
 * limite revisado, ponto de medição a mais, nome novo. Amarrar isso em código
 * obrigava um programador para cada ajuste.
 *
 * Aqui ficam só os ajustes, chaveados pelo id da ficha. A definição em vigor é
 * sempre `padrão + ajuste`, montada por `fichaEmVigor()` — assim um item novo no
 * código aparece sozinho, e um ajuste cobre só o que ele mudou.
 *
 * Guardar a ficha INTEIRA copiada seria pior: no dia em que o código ganhasse um
 * item novo, a cópia antiga do banco o esconderia para sempre.
 */

const CHAVE = 'cadastro:fichas'

export type FichasAjustadas = Record<string, Partial<DefinicaoFicha>>

export async function lerFichasAjustadas(): Promise<FichasAjustadas> {
  const registro = await db.config.get(CHAVE)
  if (!registro) return {}
  try {
    const dados = JSON.parse(registro.valor) as FichasAjustadas
    return dados && typeof dados === 'object' ? dados : {}
  } catch {
    return {}
  }
}

export const gravarFichasAjustadas = (ajustes: FichasAjustadas) =>
  db.config.put({ chave: CHAVE, valor: JSON.stringify(ajustes) })

/**
 * Ajuste aplicado por cima da ficha padrão.
 *
 * Campo ausente no ajuste = o valor do código. É o que permite voltar um item
 * ao padrão sem ter que reescrevê-lo.
 */
export function fichaEmVigor(
  padrao: DefinicaoFicha,
  ajuste?: Partial<DefinicaoFicha>,
): DefinicaoFicha {
  if (!ajuste) return padrao
  return {
    ...padrao,
    ...ajuste,
    // Itens e campos fixos não se misturam por índice: o ajuste manda inteiro
    // quando existe, senão o padrão vale. Mesclar item a item quebraria a
    // ordem e soltaria rótulos de linhas diferentes.
    itens: ajuste.itens ?? padrao.itens,
    camposFixos: ajuste.camposFixos ?? padrao.camposFixos,
    // Lista vazia acidental apagaria a navegação da ficha.
    tiposManutencao:
      ajuste.tiposManutencao && ajuste.tiposManutencao.length > 0
        ? ajuste.tiposManutencao
        : padrao.tiposManutencao,
  }
}

/** Todas as fichas em vigor: padrão com o ajuste salvo, se houver. */
export function fichasEmVigor(ajustes: FichasAjustadas): DefinicaoFicha[] {
  return FICHAS.map((f) => fichaEmVigor(f, ajustes[f.id]))
}

/** Marcas que o código conhece, para validar o ajuste que vem de fora. */
export const TIPOS_ITEM_VALIDOS = ['texto', 'numero', 'lista'] as const
