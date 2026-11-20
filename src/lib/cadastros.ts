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
  /**
   * E-mail de acesso ao app. Obrigatório para quem for usar o sistema: é por
   * ele que o Supabase identifica a pessoa no login e no convite.
   */
  email?: string
  /** cargo/função na equipe, ex.: "Eletricista de manutenção" */
  funcao?: string
  /** administrador pode manter cadastros; usuário apenas executa */
  nivel: NivelAcesso
  ativo: boolean
  /**
   * Preenchido quando o convite foi enviado: é o id da conta criada no
   * Supabase. O perfil no banco só nasce quando a pessoa abre o link e cria a
   * senha — antes disso o cadastro existe apenas no aparelho do administrador.
   */
  userId?: string
  /** e-mail foi convidado e o perfil entra no banco no aceite */
  convitePendente?: boolean
}

const CHAVE_EQUIP = 'cadastro:equipamentos'

/**
 * Nem todo mundo da equipe usa o app.
 *
 * "Equipe" é quem aparece na ficha (RG 1, RG 2) — basta nome e RG. "Acesso" é
 * quem entra no app, e isso exige e-mail, convite e senha. Misturar as duas
 * coisas obrigava a criar conta para quem só assina a ficha, e escondia na
 * lista quem ainda não tinha aceitado o convite.
 */
export type SituacaoAcesso = 'sem-acesso' | 'convite-pendente' | 'ativo' | 'inativo'

export function situacaoAcesso(p: Pessoa): SituacaoAcesso {
  if (!p.ativo) return 'inativo'
  if (p.userId) return 'ativo'
  if (p.email || p.convitePendente) return 'convite-pendente'
  return 'sem-acesso'
}

/** A pessoa consegue entrar no app hoje. */
export function temAcesso(p: Pessoa): boolean {
  return situacaoAcesso(p) === 'ativo'
}
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

/**
 * Chave de identidade do equipamento na lista.
 *
 * O `id` é a identidade de verdade, mas duas linhas criadas pelo servidor em
 * momentos diferentes ganharam ids diferentes para o MESMO contator — foi
 * assim que o CLI-CT01 ficou duplicado. Por isso a identidade que vale é o
 * nome, e o `id` só desempata. Sem isso a lista aceita dois cartões iguais: a
 * home mostra os dois e o técnico abre a ficha errada.
 */
export function chaveDoEquipamento(e: Equipamento): string {
  return normalizar(e.nome ?? '').trim()
}

/**
 * Remove equipamentos repetidos, mantendo o ÚLTIMO de cada nome.
 *
 * A ordem importa: o último é o mais recente, que é o cadastro que o
 * administrador acabou de salvar. Manter o primeiro deixaria a versão velha na
 * tela depois de uma correção.
 */
export function semEquipamentosRepetidos(lista: Equipamento[]): Equipamento[] {
  const porNome = new Map<string, Equipamento>()
  const semNome: Equipamento[] = []
  for (const equip of lista) {
    const chave = chaveDoEquipamento(equip)
    if (!chave) {
      // Sem nome não há como identificar: fica, e o cadastro pede o nome.
      semNome.push(equip)
      continue
    }
    porNome.set(chave, equip)
  }
  return [...porNome.values(), ...semNome]
}

export const gravarEquipamentos = (lista: Equipamento[]) =>
  gravarLista(CHAVE_EQUIP, semEquipamentosRepetidos(lista))

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
 * Fonte da verdade dos cadastros é o servidor (Supabase; o app lê pelo
 * `sync-server`). O aparelho guarda uma cópia local com a versão recebida:
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
 * Identificação interna, sempre com o prefixo **R** e mais
 * 5 ou 6 dígitos — `R221221`, `R22104`. Não é documento oficial (RG civil):
 * é o registro funcional da própria empresa, e por isso o formato é fixo.
 *
 * O prefixo é obrigatório. Sem ele o campo volta a ser texto livre, e foi
 * exatamente assim que "R SSP" (órgão emissor) entrou no lugar de um número.
 */
export const RG_VALIDO = /^R\d{5,6}$/i

export const rgValido = (rg: string | undefined | null): boolean =>
  RG_VALIDO.test((rg ?? '').trim())

/**
 * Um RG que na verdade é órgão emissor: "R SSP", "R SP".
 *
 * A regra atual (`R` + dígitos) já recusa isso na entrada, mas registros
 * antigos gravaram o órgão no lugar do número. A função fica para a limpeza
 * do banco em `db.ts`, que precisa reconhecer o lixo já gravado — sem isso
 * os órfãos voltam a poluir a lista de equipe.
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

/**
 * RGs de equipe gravados nos campos fixos da execução (rg1..rg6), já limpos.
 *
 * Junta o filtro de formato e o de órgão emissor num lugar só: quem lê a
 * equipe (tela, home, restauração de rota) precisa da MESMA resposta, senão a
 * tela conta 2 pessoas e o resto do app conta 1.
 */
export function extrairRgs(camposFixos: Record<string, string>): string[] {
  const vistos = new Set<string>()
  const lista: string[] = []
  for (let i = 1; i <= 6; i++) {
    const bruto = (camposFixos[`rg${i}`] ?? '').trim()
    if (!RG_VALIDO.test(bruto)) continue
    // Órgão emissor gravado no lugar do RG ("R SSP"): não é gente, e deixar
    // passar aqui faz o chip "Fora do cadastro" renascer a cada releitura da
    // ficha, mesmo depois de removido da tela.
    if (rgPareceOrgao(bruto)) continue
    const chave = bruto.replace(/[^0-9a-z]/gi, '').toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(bruto)
  }
  return lista
}

/**
 * Normaliza RG para comparação: maiúsculo, sem espaço e sem zero à esquerda.
 *
 * O zero à esquerda importa porque `R0221221` e `R221221` são a mesma pessoa
 * digitando com pressa — se a comparação fosse literal, o mesmo funcionário
 * entraria duas vezes e a trava não serviria para nada.
 */
const normalizarRg = (rg: string): string =>
  rg.trim().toUpperCase().replace(/^R0+/, 'R')

/**
 * Outra pessoa do cadastro que já usa este RG.
 *
 * Devolve a pessoa em conflito (ou `null`). O `idAtual` sai da comparação
 * para a edição não acusar a própria pessoa como duplicada.
 *
 * Inativo continua contando: desativar alguém não devolve o RG dele para a
 * empresa — o número funcional segue sendo daquele funcionário, e reaproveitar
 * misturaria o histórico das duas pessoas.
 */
export function rgEmUso(
  rg: string,
  pessoas: Pessoa[],
  idAtual?: string,
): Pessoa | null {
  if (!rgValido(rg)) return null
  const alvo = normalizarRg(rg)
  return (
    pessoas.find(
      (p) => p.id !== idAtual && rgValido(p.rg) && normalizarRg(p.rg) === alvo,
    ) ?? null
  )
}

/**
 * E-mail de acesso. Regra deliberadamente frouxa — o objetivo é pegar o erro de
 * digitação (espaço, falta de @, domínio sem ponto), não validar RFC. Quem diz
 * se o endereço existe é o envio do convite.
 */
export function emailValido(email: string | undefined | null): boolean {
  const limpo = (email ?? '').trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)
}
