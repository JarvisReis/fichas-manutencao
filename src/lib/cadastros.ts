import { db } from './db'

export interface Equipamento {
  id: string
  /** identificação curta que o técnico reconhece, ex.: "CT 02 — CD1" */
  nome: string
  /** ficha que se aplica a este equipamento */
  fichaId: string
  /** local padrão sugerido (linha, cabine, painel) */
  local: string
  marca?: string
  /** patrimônio/série do núcleo instalado */
  serie?: string
  observacao?: string
}

export type NivelAcesso = 'administrador' | 'usuario'

export interface Pessoa {
  id: string
  nome: string
  rg: string
  /** cargo/função na equipe, ex.: "Eletricista de manutenção" */
  funcao?: string
  /** administrador pode manter cadastros; usuário apenas executa */
  nivel: NivelAcesso
  ativo: boolean
}

const CHAVE_EQUIP = 'cadastro:equipamentos'
const CHAVE_PESSOAS = 'cadastro:pessoas'

/** Cadastros iniciais — servem de ponto de partida e podem ser editados no app. */
const EQUIPAMENTOS_INICIAIS: Equipamento[] = []

const PESSOAS_INICIAIS: Pessoa[] = []

async function lerLista<T>(chave: string, iniciais: T[]): Promise<T[]> {
  const registro = await db.config.get(chave)
  if (!registro) {
    await db.config.put({ chave, valor: JSON.stringify(iniciais) })
    return iniciais
  }
  try {
    return JSON.parse(registro.valor) as T[]
  } catch {
    return iniciais
  }
}

async function gravarLista<T>(chave: string, lista: T[]) {
  await db.config.put({ chave, valor: JSON.stringify(lista) })
}

export const lerEquipamentos = () => lerLista<Equipamento>(CHAVE_EQUIP, EQUIPAMENTOS_INICIAIS)
export const gravarEquipamentos = (lista: Equipamento[]) => gravarLista(CHAVE_EQUIP, lista)

export const lerPessoas = () => lerLista<Pessoa>(CHAVE_PESSOAS, PESSOAS_INICIAIS)
export const gravarPessoas = (lista: Pessoa[]) => gravarLista(CHAVE_PESSOAS, lista)

/** Normaliza para busca sem acento e sem caixa. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function filtrarEquipamentos(lista: Equipamento[], busca: string, fichaId?: string): Equipamento[] {
  const termo = normalizar(busca)
  return lista
    .filter((e) => (fichaId ? e.fichaId === fichaId : true))
    .filter((e) => {
      if (!termo) return true
      const alvo = normalizar(`${e.nome} ${e.local} ${e.serie ?? ''} ${e.marca ?? ''}`)
      return termo.split(/\s+/).every((parte) => alvo.includes(parte))
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export function filtrarPessoas(lista: Pessoa[], busca: string): Pessoa[] {
  const termo = normalizar(busca)
  return lista
    // Inativo sai da seleção da execução — mas continua aparecendo no editor
    // de cadastros, onde o administrador pode reativar. Desativar é "não
    // escalar mais", não "apagar".
    // RG que é órgão emissor ("R SSP") também sai: cadastro sem nome de
    // gente não é pessoa, e aparecia na lista como se fosse.
    .filter(pessoaSelecionavel)
    .filter((p) => {
      if (!termo) return true
      return normalizar(`${p.nome} ${p.rg} ${p.funcao ?? ''}`).includes(termo)
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export function novoId(): string {
  return crypto.randomUUID()
}

/* --------------------------- cadastros no servidor -------------------------- */

/**
 * Fonte da verdade dos cadastros é o servidor (`admin-server.mjs` → lista
 * ConfigFichas). O aparelho guarda uma cópia local com a versão recebida:
 * o app nunca deixa uma cópia mais velha sobrescrever uma mais nova.
 */
const CHAVE_VERSAO = 'cadastro:versao'

export async function lerVersao(): Promise<number> {
  const registro = await db.config.get(CHAVE_VERSAO)
  return registro ? Number(registro.valor) || 0 : 0
}

export async function gravarVersao(versao: number) {
  await db.config.put({ chave: CHAVE_VERSAO, valor: String(versao) })
}

/** Aplica um conjunto de cadastros vindo do servidor, se for mais novo. */
export async function aplicarCadastrosDoServidor(dados: {
  versao: number
  pessoas?: Pessoa[]
  equipamentos?: Equipamento[]
}): Promise<boolean> {
  const local = await lerVersao()
  if (!dados.versao || dados.versao < local) return false
  if (Array.isArray(dados.pessoas)) await gravarPessoas(dados.pessoas)
  if (Array.isArray(dados.equipamentos)) await gravarEquipamentos(dados.equipamentos)
  await gravarVersao(dados.versao)
  return true
}

/**
 * O que conta como RG.
 *
 * Mora aqui — e não dentro de uma tela — porque cadastro e execução precisam
 * concordar. A versão antiga do filtro de execução exigia começar com dígito
 * (`/^[0-9][0-9.\-/]*$/`), mas o formulário de cadastro aceitava qualquer
 * texto: RG com prefixo de estado (`MG-12345`, `SP1234567`) era gravado e
 * depois descartado em silêncio na hora de montar a equipe — a pessoa
 * aparecia na lista, o toque não marcava, e nada explicava o motivo.
 *
 * Regra: de 2 a 20 caracteres, com ao menos um dígito, sem caractere de
 * controle. Aceita letras, números, ponto, hífen, barra e espaço — os formatos
 * que aparecem de fato em RG brasileiro.
 */
export const RG_VALIDO = /^(?=.*\d)[0-9A-Za-zÀ-ÿ][0-9A-Za-zÀ-ÿ.\-/ ]{1,19}$/

export const rgValido = (rg: string | undefined | null): boolean =>
  RG_VALIDO.test((rg ?? '').trim())

/**
 * Um RG que na verdade é órgão emissor: "R SSP", "R SP", "R 123".
 *
 * O campo RG do cadastro aceita texto livre, então o técnico às vezes digita
 * o órgão emissor em vez do número — e o registro entra na equipe como se
 * fosse gente. "R" sozinho como primeiro caractere seguido de espaço não é
 * início de RG nenhum: nenhum RG brasileiro começa assim, e o formato é
 * exatamente o da sigla do órgão abreviado.
 */
const RG_COMO_ORGAO = /^R\s/i

export const rgPareceOrgao = (rg: string | undefined | null): boolean =>
  RG_COMO_ORGAO.test((rg ?? '').trim())

/**
 * Só quem realmente entra na equipe: tem nome e RG que não é órgão.
 *
 * Usado nas listas de seleção da execução. No cadastro a pessoa continua
 * aparecendo — é lá que o administrador corrige o RG errado.
 */
export const pessoaSelecionavel = (p: Pessoa): boolean =>
  p.ativo !== false && p.nome.trim().length > 0 && !rgPareceOrgao(p.rg)
