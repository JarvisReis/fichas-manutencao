import type { DefinicaoFicha } from '../types'

/**
 * Grupos de equipamento mostrados como abas na home. O grupo de um contator é o
 * grupo da ficha dele — não é campo novo no cadastro: quem já tem contator
 * cadastrado não precisa ser reclassificado.
 */
export const GRUPOS: { id: string; rotulo: string }[] = [
  { id: 'contator', rotulo: 'Contator' },
  { id: 'seccionadora', rotulo: 'Contator de Seccionadora' },
]

export function grupoDaFicha(fichaId: string): string {
  return fichaId === 'SC-BI1' ? 'seccionadora' : 'contator'
}

/**
 * Definições das fichas de campo do Metrô.
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
      { id: 'torqPatrimonio', nome: 'Torquímetro — Patrimônio', tipo: 'texto' },
      { id: 'serieInstalado', nome: 'Nº Série do Núcleo — Instalado', tipo: 'lista', lista: 'nucleos' },
      { id: 'serieRetirado', nome: 'Nº Série do Núcleo — Retirado', tipo: 'lista', lista: 'nucleos' },
      { id: 'rg1', nome: 'Funcionário 1 — RG', tipo: 'texto' },
      { id: 'rg2', nome: 'Funcionário 2 — RG', tipo: 'texto' },
      { id: 'rg3', nome: 'Funcionário 3 — RG', tipo: 'texto' },
    ],
  },
  {
    id: 'CT-FICHA',
    nome: 'Ficha de Acompanhamento do Contator',
    nomeCurto: 'Contator (marca)',
    subtitulo: 'Ficha Schneider / Merlin Gerin · 8 pontos de medição',
    prefixo: 'CT',
    exigeMarca: true,
    tiposManutencao: ['P1', 'P2'],
    itens: [
      {
        id: 'nucleo-estrutura',
        nome: 'Barram. do Núcleo X Estr. Metálica',
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
        id: 'barr1-estrutura',
        nome: 'Barramento 1 X Estrutura',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 70,
        aceitaInfinito: true,
      },
      {
        id: 'barr2-estrutura',
        nome: 'Barramento 2 X Estrutura',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 70,
        aceitaInfinito: true,
      },
      {
        id: 'barr1-barr2',
        nome: 'Barramento 1 X Barramento 2',
        instrumento: 'Medidor de Isolação',
        unidade: 'MΩ',
        direcao: 'min',
        limite: 70,
        aceitaInfinito: true,
        apenasMarca: 'merlin',
      },
      {
        id: 'cub-nt-cubo',
        nome: 'Barr. do Cubículo X Núcleo do Contator',
        instrumento: 'Microohmímetro (res. de contato)',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 80,
      },
      {
        id: 'contatos-barr',
        nome: 'Contatos Principais X Con. dos Barramentos',
        instrumento: 'Microohmímetro (res. de contato)',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 60,
      },
      {
        id: 'cabos-barr',
        nome: 'Cabos X Barramentos',
        instrumento: 'Microohmímetro (res. de contato)',
        unidade: 'µΩ',
        direcao: 'max',
        limite: 30,
        limiteSchneider: 15,
      },
    ],
    camposFixos: [
      { id: 'torqPatrimonio', nome: 'Torquímetro — Patrimônio', tipo: 'texto' },
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
      { id: 'torqPatrimonio', nome: 'Torquímetro — Patrimônio', tipo: 'texto' },
      { id: 'rg1', nome: 'Funcionário 1 — RG', tipo: 'texto' },
      { id: 'rg2', nome: 'Funcionário 2 — RG', tipo: 'texto' },
      { id: 'rg3', nome: 'Funcionário 3 — RG', tipo: 'texto' },
    ],
  },
]

export function getFicha(id: string): DefinicaoFicha | undefined {
  return FICHAS.find((f) => f.id === id)
}
