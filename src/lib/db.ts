import Dexie, { type Table } from 'dexie'
import { MARCA_CONTATOR, type Execucao } from '../types'
import { rascunhoExpirado } from './permissoes'
import { rgPareceOrgao } from './cadastros'

/**
 * Banco local do app. Tudo é gravado aqui primeiro — a sincronização com o
 * O envio ao servidor é uma etapa separada que só roda quando há rede.
 */
export class FichasDB extends Dexie {
  execucoes!: Table<Execucao, string>
  config!: Table<{ chave: string; valor: string }, string>

  constructor() {
    // Nome do banco no IndexedDB. Mantido como está de propósito: renomear
    // criaria um banco novo e vazio, e o técnico perderia as fichas locais.
    super('fichas-metro')
    this.version(1).stores({
      execucoes: 'id, codigo, fichaId, status, sincronizada, criadaEm, dataHora, atualizadaEm',
      config: 'chave',
    })
  }
}

export const db = new FichasDB()

/**
 * Endpoint de sincronização (proxy do Raspberry). Lido de VITE_SYNC_URL em tempo
 * de build; `localStorage['fichas:syncUrl']` sobrescreve para testes em campo.
 */
export function lerEndpointSync(): string {
  try {
    const salvo = localStorage.getItem('fichas:syncUrl')
    if (salvo && salvo.trim()) return salvo.trim()
  } catch {
    /* localStorage indisponível */
  }
  return (import.meta.env.VITE_SYNC_URL as string | undefined)?.trim() ?? ''
}

/**
 * Endpoint do serviço de administração (cadastros com senha). Vive na mesma
 * máquina do sync, porta 8788: `http://<host>:8787/fichas` → `http://<host>:8788`.
 * `localStorage['fichas:adminUrl']` sobrescreve; sem endereço, o cadastro fica
 * só no aparelho (e o app avisa).
 */
export function obterEndpointAdmin(): string {
  try {
    const salvo = localStorage.getItem('fichas:adminUrl')
    if (salvo && salvo.trim()) return salvo.trim().replace(/\/$/, '')
    const sync = lerEndpointSync()
    if (sync) return sync.replace(/\/fichas\/?$/, '').replace(/:8787\b/, ':8788').replace(/\/$/, '')
  } catch {
    /* localStorage indisponível */
  }
  const build = (import.meta.env.VITE_ADMIN_URL as string | undefined)?.trim()
  return build ? build.replace(/\/$/, '') : ''
}

/** Memória de campos fixos por ficha (torquímetro, RGs, séries). */
export async function lerCamposFixos(fichaId: string): Promise<Record<string, string>> {
  const registro = await db.config.get(`camposFixos:${fichaId}`)
  if (!registro) return {}
  try {
    return JSON.parse(registro.valor) as Record<string, string>
  } catch {
    return {}
  }
}

export async function salvarCamposFixos(fichaId: string, valores: Record<string, string>) {
  await db.config.put({ chave: `camposFixos:${fichaId}`, valor: JSON.stringify(valores) })
}

/**
 * Último núcleo instalado conhecido em um equipamento.
 *
 * O vínculo núcleo↔contator só é confirmado na P2; por isso a memória por ficha
 * (camposFixos:<fichaId>) não serve. Aqui procuramos a execução mais recente do
 * equipamento que tenha `nucleoInstalado` gravado, e aceitamos a própria execução
 * atual como candidata (para rascunhos em andamento).
 */
export async function lerNucleoInstalado(
  equipamento: string,
  atual: { id: string; equipamento?: string; nucleoInstalado?: string; atualizadaEm: string },
): Promise<string | undefined> {
  const alvo = equipamento.trim()
  if (!alvo) return undefined

  const execucoes = await db.execucoes.toArray()
  const candidatas = execucoes.filter(
    (e) => (e.camposFixos.equipamento ?? '').trim() === alvo && !!e.nucleoInstalado?.trim(),
  )

  if (atual.equipamento?.trim() === alvo && atual.nucleoInstalado?.trim()) {
    candidatas.push({
      ...atual,
      nucleoInstalado: atual.nucleoInstalado,
    } as (typeof candidatas)[number])
  }

  candidatas.sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm))
  return candidatas[0]?.nucleoInstalado?.trim()
}

/**
 * Identificação da manutenção: nome do equipamento + data.
 *
 * O técnico lê "CT 02 · 12/11/2026" e sabe de que equipamento e de que dia é a
 * ficha. Quando a manutenção cobre mais de um dia (contator = 2 dias), a
 * identificação leva o intervalo: "CT 02 · 12–13/11/2026".
 *
 * O horário só entra quando o mesmo equipamento já tem ficha no mesmo dia —
 * aí a identificação precisa de algo a mais para continuar única.
 */
export function gerarCodigo(
  equipamento: string,
  data: Date = new Date(),
  existentes: { codigo: string }[] = [],
  dataFim?: string,
): string {
  const nome = equipamento.trim()
  const dia = data.toLocaleDateString('pt-BR')
  const diaFim = dataFim ? new Date(dataFim) : null
  const fimValido = diaFim && diaFim.getTime() !== data.getTime() ? diaFim : null

  const base = fimValido ? `${nome} · ${intervalo(data, fimValido)}` : `${nome} · ${dia}`

  const mesmoDia = existentes.some((e) => e.codigo.startsWith(`${nome} · `) && e.codigo === base)
  if (!mesmoDia) return base
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${base} ${hora}`
}

/**
 * Ficha zerada de um equipamento recém-cadastrado.
 *
 * É um rascunho vazio: existe para o equipamento aparecer com ficha pendente na
 * home e no histórico desde o primeiro dia, e para o técnico ter de onde partir.
 * Todas as medições nascem em branco — não é dado falso, é ficha aberta.
 */
export function fichaZerada(
  equipamento: { nome: string; local?: string; fichaId: string },
  ficha: { id: string; tiposManutencao: string[]; itens: { id: string }[] },
): Execucao {
  const agora = new Date()
  return {
    id: crypto.randomUUID(),
    codigo: gerarCodigo(equipamento.nome.trim(), agora, []),
    fichaId: ficha.id,
    marca: undefined,
    tipoManutencao: ficha.tiposManutencao[0] as Execucao['tipoManutencao'],
    cabecalho: {},
    camposFixos: { equipamento: equipamento.nome.trim() },
    local: equipamento.local ?? '',
    dataHora: agora.toISOString(),
    valores: ficha.itens.map((item) => ({ itemId: item.id, valor: '' })),
    status: 'rascunho',
    sincronizada: false,
    criadaEm: agora.toISOString(),
    atualizadaEm: agora.toISOString(),
  }
}

/** "12–13/11/2026" quando o mês/ano é o mesmo; senão, as duas datas inteiras. */
function intervalo(inicio: Date, fim: Date): string {
  const mesmaReferencia =
    inicio.getMonth() === fim.getMonth() && inicio.getFullYear() === fim.getFullYear()
  if (mesmaReferencia) {
    const d = (n: number) => String(n).padStart(2, '0')
    return `${d(inicio.getDate())}–${fim.toLocaleDateString('pt-BR')}`
  }
  return `${inicio.toLocaleDateString('pt-BR')}–${fim.toLocaleDateString('pt-BR')}`
}

/* ------------------------- limpeza de rascunhos ---------------------------- */

/**
 * Apaga os rascunhos vencidos.
 *
 * Roda na abertura do app, antes de qualquer tela: assim a seção "Continuar"
 * da home nunca mostra trabalho que já venceu. Devolve quantos foram apagados
 * para a home poder avisar o técnico — apagar em silêncio um trabalho que a
 * pessoa esqueceu é o tipo de coisa que faz ela desconfiar do app.
 *
 * Falha de leitura de um registro não pode travar a limpeza dos outros: cada
 * exclusão é independente.
 */
export async function limparRascunhosVencidos(agora: number = Date.now()) {
  const vencidos: string[] = []
  await db.execucoes.each((exec) => {
    if (rascunhoExpirado(exec, agora)) vencidos.push(exec.id)
  })

  for (const id of vencidos) {
    await db.execucoes.delete(id)
  }

  return vencidos.length
}

/**
 * Tira da ficha os RGs que na verdade são órgão emissor ("R SSP").
 *
 * Filtro na leitura não basta: o valor continua gravado no registro, e volta a
 * aparecer como chip "Fora do cadastro" em qualquer tela que leia direto do
 * banco. Aqui o campo é apagado de vez, uma vez só, na abertura do app.
 *
 * Não mexe em RG válido nem em ficha concluída — só limpa a sujeira que a
 * validação antiga deixou passar.
 */
export async function limparRgOrgaoGravado(): Promise<number> {
  // Lê tudo e filtra em memória: `Collection.each` com callback async não
  // espera a promise, então o `put` de dentro escapava da transação e a
  // limpeza não gravava nada. Arrays de verdade são mais previsíveis aqui —
  // é uma leitura só, na abertura, e o volume é pequeno.
  const todas = await db.execucoes.toArray()
  let corrigidas = 0
  for (const exec of todas) {
    const campos: Record<string, string> = { ...(exec.camposFixos ?? {}) }
    let mudou = false
    for (let i = 1; i <= 6; i++) {
      const chave = `rg${i}`
      if (rgPareceOrgao(campos[chave] ?? '')) {
        delete campos[chave]
        mudou = true
      }
    }
    if (!mudou) continue
    await db.execucoes.put({ ...exec, camposFixos: campos })
    corrigidas += 1
  }
  return corrigidas
}

/**
 * Converte a chave antiga de marca (`schneider`) para a atual (`secheron`).
 *
 * Roda na abertura do app. Sem isso, execução gravada antes da renomeação
 * continuaria com uma chave que o código não reconhece mais — perderia de
 * silêncio o limite próprio da marca (15 µΩ em vez de 30 µΩ em Cabos X
 * Barramentos), e o erro seria invisível na tela.
 *
 * Mesmo cuidado de `limparRgOrgaoGravado`: `toArray` + `for`, nunca `each`
 * com callback async.
 */
export async function migrarChaveMarca(): Promise<number> {
  const todas = await db.execucoes.toArray()
  let migradas = 0
  for (const exec of todas) {
    const bruta = exec.marca as string | undefined
    if (bruta !== 'schneider') continue
    await db.execucoes.put({ ...exec, marca: MARCA_CONTATOR })
    migradas += 1
  }
  return migradas
}
