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
    .filter((p) => p.ativo !== false)
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
