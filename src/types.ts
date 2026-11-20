export type Unidade = 'MΩ' | 'µΩ' | 'A'
export type Direcao = 'min' | 'max'
/**
 * Marca do contator. Hoje existe uma só, a Sechéron. O tipo continua existindo
 * porque registros antigos gravaram `merlin` — neles a marca é `merlin` até
 * alguém reabrir e salvar, e aí a migração converte.
 */
export type Marca = 'merlin' | 'secheron'

/** Marca única dos contatores. Não é escolha do técnico. */
export const MARCA_CONTATOR: Marca = 'secheron'

/**
 * Chave antiga que ficou gravada em execuções e no servidor. Só serve para
 * LER: nada é mais gravado como `schneider`.
 */
const CHAVE_ANTIGA = 'schneider'

/**
 * Erros de digitação já vistos no cadastro de equipamentos (`Scheron` sem o
 * "e"). São lidos como Sechéron para não mudar o limite do ensaio.
 */
const VARIANTES_SECHERON = new Set(['scheron', 'secheronn', 'secheron'])

/**
 * Reduz a marca a letras minúsculas sem acento, para comparar.
 * O banco e planilhas já gravaram `Secheron`, `SECHERON` e `Sechéron`; se a
 * comparação fosse exata, todos cairiam em `undefined` e o item perderia o
 * limite próprio (15 µΩ) em silêncio, voltando ao padrão de 30 µΩ.
 */
function chaveDaMarca(bruta: string): string {
  return bruta
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Converte a marca lida do banco/servidor para a chave atual.
 * Sem isso, execução antiga com `schneider` passaria a ser tratada como
 * "marca que não existe" e perderia o limite próprio.
 *
 * Aceita qualquer caixa e acentuação. Variantes conhecidas de digitação da
 * Sechéron (`scheron`, `secheronn`) também são aceitas: errar uma letra no
 * cadastro não pode mudar o limite do ensaio.
 */
export function normalizarMarca(bruta?: string | null): Marca | undefined {
  if (!bruta) return undefined
  const chave = chaveDaMarca(bruta)
  if (chave === CHAVE_ANTIGA) return MARCA_CONTATOR
  if (chave === 'merlin') return 'merlin'
  if (chave === MARCA_CONTATOR || VARIANTES_SECHERON.has(chave)) return MARCA_CONTATOR
  return undefined
}

/** Nome da marca como aparece na tela. Um lugar só: ficha, medição e etiqueta. */
export const NOME_MARCA: Record<Marca, string> = {
  merlin: 'Merlin Gerin',
  secheron: 'Sechéron',
}
export type TipoManutencao = 'P1' | 'P2'

export type ResultadoItem = 'conforme' | 'nao_conforme' | 'na'

export interface ItemFicha {
  /** identificador estável do item dentro da ficha */
  id: string
  /** rótulo exatamente como na ficha de papel */
  nome: string
  instrumento: string
  unidade: Unidade
  direcao: Direcao
  /** limite padrão do item */
  limite: number
  /** limite quando o equipamento é Schneider, se diferente do padrão */
  limiteSchneider?: number
  /** item que só se aplica a uma marca (hoje nenhum: todos os contatores são Schneider) */
  apenasMarca?: Marca
  /** permite digitar "∞" (itens de isolação) */
  aceitaInfinito?: boolean
}

export interface CampoExtra {
  id: string
  nome: string
  tipo: 'texto' | 'numero' | 'lista'
  /**
   * Nome da lista fixa que alimenta um campo tipo 'lista'.
   * Hoje só 'nucleos' (HPB001–HPB099), em src/config/nucleos.ts.
   */
  lista?: 'nucleos'
}

export interface DefinicaoFicha {
  id: string
  nome: string
  nomeCurto: string
  subtitulo: string
  /** prefixo do código da execução, ex.: CT */
  prefixo: string
  /** se true, a ficha pede a marca do equipamento */
  exigeMarca: boolean
  /**
   * Tipos de manutenção aplicáveis. Contator aceita P1 e P2; seccionador só P2.
   * Quando há mais de um, o app mostra um seletor na identificação.
   */
  tiposManutencao: TipoManutencao[]
  /**
   * Quantos dias a manutenção dura. O contator é feito em 2 dias e fecha UMA
   * ficha só (a identificação vira um intervalo de datas); o seccionador é de
   * um dia. Ausente = 1 dia.
   */
  dias?: number
  itens: ItemFicha[]
  /** campos fixos por equipamento, guardados com memória do último valor */
  camposFixos: CampoExtra[]
}

export interface ValorItem {
  itemId: string
  /** string crua digitada ("∞" é válido) */
  valor: string
  observacao?: string
  /**
   * Limite e direção que valiam no instante da medição.
   *
   * O administrador pode revisar um limite depois — e aí a medição antiga
   * passa a parecer "conforme" por uma régua que não existe mais. Guardar o
   * valor usado permite marcar no app e no PDF que a régua mudou, sem
   * reescrever o que foi medido. Ausente em fichas antigas: nesse caso nada é
   * afirmado.
   */
  limiteUsado?: number
  direcaoUsada?: 'max' | 'min'
  unidadeUsada?: string
}

export interface Execucao {
  id: string
  codigo: string
  fichaId: string
  marca?: Marca
  tipoManutencao?: TipoManutencao
  cabecalho: Record<string, string>
  camposFixos: Record<string, string>
  /**
   * Núcleo instalado no contator (HPB001–HPB099). Preenchido automaticamente a
   * partir da última manutenção do equipamento; só é editado na P2 (onde se
   * troca o núcleo). Na P1 fica somente leitura.
   */
  nucleoInstalado?: string
  local: string
  dataHora: string
  /**
   * Data de encerramento, quando a ficha cobre mais de um dia (contator: 2 dias).
   * Ausente ou igual a `dataHora` = manutenção de um dia só.
   */
  dataFim?: string
  valores: ValorItem[]
  observacaoGeral?: string
  /**
   * `pendente` = concluída com pelo menos uma medição fora do limite. Ela é
   * salva do mesmo jeito (nada bloqueia o técnico em campo), mas fica marcada
   * em vermelho até alguém tratar o desvio.
   */
  status: 'rascunho' | 'concluida' | 'pendente'
  /** pessoa que criou a execução — só ela usa a janela de correção de 24 h */
  criadaPor?: string
  sincronizada: boolean
  criadaEm: string
  atualizadaEm: string
}
