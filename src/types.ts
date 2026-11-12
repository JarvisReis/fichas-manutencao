export type Unidade = 'MΩ' | 'µΩ' | 'A'
export type Direcao = 'min' | 'max'
export type Marca = 'merlin' | 'schneider'
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
  /** limite para Merlin Gerin (ou único, quando não varia por marca) */
  limite: number
  /** limite quando o equipamento é Schneider, se diferente */
  limiteSchneider?: number
  /** true quando o item não se aplica a alguma marca (ex.: B1 X B2 só existe em MG) */
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
  fotoId?: string
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

export interface Foto {
  id: string
  execucaoId: string
  itemId: string
  blob: Blob
  criadaEm: string
}
