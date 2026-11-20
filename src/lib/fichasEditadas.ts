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

/**
 * Controle da versão publicada no servidor.
 *
 * `cadastro:fichasEm` guarda o carimbo da última versão que este aparelho
 * aplicou; `cadastro:fichasPendente` existe quando o administrador salvou sem
 * rede e a publicação ainda não aconteceu. Separar os dois evita o pior caso:
 * baixar por cima de uma alteração local que nunca subiu.
 */
const CHAVE_REMOTO = 'cadastro:fichasEm'
const CHAVE_PENDENTE = 'cadastro:fichasPendente'

export async function lerVersaoAplicada(): Promise<string | null> {
  const registro = await db.config.get(CHAVE_REMOTO)
  return registro?.valor || null
}

export const gravarVersaoAplicada = (carimbo: string) =>
  db.config.put({ chave: CHAVE_REMOTO, valor: carimbo })

export async function lerPublicacaoPendente(): Promise<boolean> {
  const registro = await db.config.get(CHAVE_PENDENTE)
  return registro?.valor === '1'
}

export const marcarPublicacaoPendente = (pendente: boolean) =>
  db.config.put({ chave: CHAVE_PENDENTE, valor: pendente ? '1' : '0' })

/**
 * Vale baixar o que está no servidor?
 *
 * Só quando o carimbo remoto é mais novo que o aplicado e o carimbo é uma data
 * válida — servidor sem ajuste nenhum devolve `null`, e aí não há o que baixar
 * (nem motivo para apagar o ajuste que já existe aqui).
 */
export function deveAplicarRemoto(
  versaoAplicada: string | null,
  atualizadoEm: string | null | undefined,
): boolean {
  if (!atualizadoEm) return false
  const remoto = Date.parse(atualizadoEm)
  if (Number.isNaN(remoto)) return false
  if (!versaoAplicada) return true
  const local = Date.parse(versaoAplicada)
  if (Number.isNaN(local)) return true
  return remoto > local
}
