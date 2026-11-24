import type { DefinicaoFicha } from '../types'

/**
 * Grupos de equipamento mostrados como abas na home. O grupo de um contator é o
 * grupo da ficha dele — não é campo novo no cadastro: quem já tem contator
 * cadastrado não precisa ser reclassificado.
 */
export const GRUPOS: { id: string; rotulo: string }[] = [
  { id: 'contator', rotulo: 'Contator' },
  { id: 'seccionadora', rotulo: 'Seccionadora' },
]

export function grupoDaFicha(fichaId: string): string {
  return fichaId === 'SC-BI1' ? 'seccionadora' : 'contator'
}

/**
 * Definições das fichas de campo.
 *
 * Cada ficha aqui é transcrição do formulário em papel — os limites, unidades e
 * instrumentos vêm da ficha modelo original. Adicionar um novo tipo de
 * equipamento é acrescentar um objeto nesta lista; nenhuma tela precisa mudar.
 */
export const FICHAS: DefinicaoFicha[] = [
  {
    id: 'CT-BI',
    nome: 'Histórico de Acompanhamento de Contator (BI)',
    nomeCurto: 'Contator BI',
    subtitulo: 'Ficha modelo CT01 · 5 pontos de medição',
    prefixo: 'CT',
    exigeMarca: false,
    tiposManutencao: ['P1', 'P2'],
    dias: 2,
    itens: [
      {
        id: 'barr-nucleo-barr',
        nome: 'Barramento X Núcleo X Barramento',
        instrumento: 'Microohmímetro',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 80,
      },
      {
        id: 'cabo400-barr',
        nome: 'Cabo 400 mm X Barramento',
        instrumento: 'Microohmímetro',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 15,
      },
      {
        id: 'nucleo-carcaca',
        nome: 'Barram. do Núcleo X Carcaça do Núcleo',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 30,
        aceitaInfinito: true,
      },
      {
        id: 'estrutura-terra',
        nome: 'Estrutura X Terra externo',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 10,
        aceitaInfinito: true,
      },
      {
        id: 'barramento-estrutura',
        nome: 'Barramento X Estrutura',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 70,
        aceitaInfinito: true,
      },
    ],
    camposFixos: [
      { id: 'microPatrimonio', nome: 'Microohmímetro — Patrimônio', tipo: 'texto' },
      { id: 'megaPatrimonio', nome: 'Megômetro — Patrimônio', tipo: 'texto' },
      { id: 'torqPatrimonio', nome: 'Torquímetro — Patrimônio', tipo: 'texto' },
      { id: 'serieInstalado', nome: 'Nº Série do Núcleo — Instalado', tipo: 'lista', lista: 'nucleos' },
      { id: 'serieRetirado', nome: 'Nº Série do Núcleo — Retirado', tipo: 'lista', lista: 'nucleos' },
      { id: 'rg1', nome: 'Funcionário 1 — RG', tipo: 'texto' },
      { id: 'rg2', nome: 'Funcionário 2 — RG', tipo: 'texto' },
      { id: 'rg3', nome: 'Funcionário 3 — RG', tipo: 'texto' },
    ],
  },
  {
    id: 'SC-BI1',
    nome: 'Histórico de Acompanhamento de Seccionador (BI 1)',
    nomeCurto: 'Seccionador BI 1',
    subtitulo: 'Ficha modelo Seccionador BI 1 · 5 pontos de medição',
    prefixo: 'SC',
    exigeMarca: false,
    tiposManutencao: ['P1'],
    dias: 1,
    itens: [
      {
        id: 'corrente-motor',
        nome: 'Corrente do Motor',
        instrumento: 'Amperímetro',
        unidade: 'A',
        direcao: 'max',
        limite: 3,
      },
      {
        id: 'contato-barr',
        nome: 'Contato Principal X Barramento',
        instrumento: 'Microohmímetro',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 30,
      },
      {
        id: 'cabo400-barr',
        nome: 'Cabo 400 mm X Barramento',
        instrumento: 'Microohmímetro',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 15,
      },
      {
        id: 'estrutura-terra',
        nome: 'Estrutura X Terra externo',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 10,
        aceitaInfinito: true,
      },
      {
        id: 'barramento-estrutura',
        nome: 'Barramento X Estrutura',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 70,
        aceitaInfinito: true,
      },
    ],
    camposFixos: [
      { id: 'microPatrimonio', nome: 'Microohmímetro — Patrimônio', tipo: 'texto' },
      { id: 'megaPatrimonio', nome: 'Megômetro — Patrimônio', tipo: 'texto' },
      { id: 'torqPatrimonio', nome: 'Torquímetro — Patrimônio', tipo: 'texto' },
      { id: 'rg1', nome: 'Funcionário 1 — RG', tipo: 'texto' },
      { id: 'rg2', nome: 'Funcionário 2 — RG', tipo: 'texto' },
      { id: 'rg3', nome: 'Funcionário 3 — RG', tipo: 'texto' },
    ],
  },
]

/**
 * Cópia em memória das fichas em vigor.
 *
 * `getFicha` é chamado de 20 lugares, muitos deles síncronos (render, PDF,
 * sincronização). Transformá-lo em async obrigaria a mexer em todos. Em vez
 * disso, o app carrega os ajustes do administrador uma vez na abertura
 * (`carregarFichas`) e troca esta tabela aqui.
 */
let emVigor: DefinicaoFicha[] = FICHAS

/** Troca as definições ativas. Chamado na abertura do app e após salvar ajuste. */
export function definirFichasEmVigor(lista: DefinicaoFicha[]): void {
  emVigor = lista
}

export function fichasAtivas(): DefinicaoFicha[] {
  return emVigor
}

export function getFicha(id: string): DefinicaoFicha | undefined {
  return emVigor.find((f) => f.id === id)
}
