import { db } from './db'
export { obterEndpointAdmin } from './db'
import { getFicha } from '../config/fichas'
import { avaliarItem, limiteExibido } from './conformidade'
import type { DefinicaoFicha, Marca } from '../types'

/**
 * Payload de uma execução no formato que o Power Automate consome.
 *
 * Mudança de contrato (v2): em vez de um pacote com `execucoes[]` + `fotos[]`,
 * cada envio é UM objeto de execução. Assim o fluxo grava direto em
 * `FichasExecucoes` sem loop de validação, e o núcleo instalado/retirado vira
 * campo próprio da lista (é a fonte da verdade do vínculo núcleo↔contator).
 */
export type ResultadoExportado = 'conforme' | 'nao_conforme' | 'na'

export const FORMATO_ENVIO = 'fichas-execucao'
export const VERSAO_ENVIO = 2

export interface FotoExportada {
  id: string
  itemId: string
  mime: string
  base64: string
}

export interface ExecucaoExportada {
  formato: typeof FORMATO_ENVIO
  versao: typeof VERSAO_ENVIO
  /** chave de idempotência usada pelo fluxo (ExecucaoId) */
  id: string
  codigo: string
  fichaId: string
  fichaNome: string
  equipamento: string
  marca?: string
  tipoManutencao?: string
  nucleoInstalado?: string
  nucleoRetirado?: string
  local: string
  dataHora: string
  /** encerramento, quando a ficha cobre mais de um dia */
  dataFim?: string
  status: string
  observacaoGeral?: string
  naoConformes: number
  enviadoEm: string
  aparelho: string
  cabecalho: Record<string, string>
  valores: {
    itemId: string
    itemNome: string
    valor: string
    observacao?: string
    /** veredito já calculado pelo app, para o fluxo só transportar */
    resultado: ResultadoExportado
    unidade?: string
    limite?: string
  }[]
  fotos: FotoExportada[]
}

/** Monta o payload de uma execução pronta para envio. */
export async function montarEnvio(execucaoId: string): Promise<ExecucaoExportada | null> {
  const exec = await db.execucoes.get(execucaoId)
  if (!exec) return null
  const ficha = getFicha(exec.fichaId)
  const fotos = await db.fotos.where('execucaoId').equals(execucaoId).toArray()

  const fotosExportadas: FotoExportada[] = []
  for (const foto of fotos) {
    fotosExportadas.push({
      id: foto.id,
      itemId: foto.itemId,
      mime: foto.blob.type || 'image/jpeg',
      base64: await blobParaBase64(foto.blob),
    })
  }

  const valores = mapearValores(exec, ficha)
  const naoConformes = valores.filter((v) => v.resultado === 'nao_conforme').length

  return {
    formato: FORMATO_ENVIO,
    versao: VERSAO_ENVIO,
    id: exec.id,
    codigo: exec.codigo,
    fichaId: exec.fichaId,
    fichaNome: ficha?.nome ?? exec.fichaId,
    equipamento: exec.camposFixos.equipamento ?? '',
    marca: exec.marca,
    tipoManutencao: exec.tipoManutencao,
    nucleoInstalado: exec.nucleoInstalado || undefined,
    nucleoRetirado: exec.tipoManutencao === 'P2' ? exec.camposFixos.serieRetirado || undefined : undefined,
    local: exec.local,
    dataHora: exec.dataHora,
    dataFim: exec.dataFim,
    status: exec.status,
    observacaoGeral: exec.observacaoGeral,
    naoConformes,
    enviadoEm: new Date().toISOString(),
    aparelho: detectarAparelho(),
    cabecalho: exec.cabecalho,
    valores,
    fotos: fotosExportadas,
  }
}

/** Cabeçalhos do envio, incluindo o token do proxy quando configurado. */
function cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = { ...extra }
  try {
    const token = localStorage.getItem('fichas:syncToken')
    if (token && token.trim()) base.Authorization = `Bearer ${token.trim()}`
  } catch {
    /* localStorage indisponível */
  }
  return base
}

export interface ResultadoEnvio {
  /** gravações efetivamente feitas no SharePoint */
  gravadas: number
  ignoradas: number
  falhas: { id: string; codigo: string; erro: string }[]
}

/**
 * Envia uma execução para o endpoint do proxy (Power Automate ou Graph).
 * Só marca `sincronizada` quando o servidor confirma. Erro de rede mantém a
 * execução na fila, sem perder nada.
 */
export async function enviarExecucao(
  execucaoId: string,
  endpoint: string,
  opcoes: { reenvioAdmin?: boolean } = {},
): Promise<{ ok: boolean; erro?: string }> {
  const payload = await montarEnvio(execucaoId)
  if (!payload) return { ok: false, erro: 'Execução não encontrada' }

  try {
    const resposta = await fetch(endpoint, {
      method: 'POST',
      headers: cabecalhos({ 'Content-Type': 'application/json' }),
      // correção de ficha já concluída: só o app de administrador manda esta marca,
      // e o servidor recusa o reenvio sem ela quando a linha está concluída.
      body: JSON.stringify(opcoes.reenvioAdmin ? { ...payload, reenvioAdmin: true } : payload),
    })
    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => '')
      return { ok: false, erro: `HTTP ${resposta.status}${texto ? `: ${texto.slice(0, 200)}` : ''}` }
    }
    await db.execucoes.update(execucaoId, {
      sincronizada: true,
      atualizadaEm: new Date().toISOString(),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: `Sem conexão com ${endpoint}: ${(e as Error).message}` }
  }
}

/** Envia todas as execuções ainda não sincronizadas (a fila). */
export async function sincronizarPendentes(
  endpoint: string,
  aoProgredir?: (feitas: number, total: number) => void,
): Promise<ResultadoEnvio> {
  const pendentes = await db.execucoes.filter((e) => !e.sincronizada).toArray()
  const resultado: ResultadoEnvio = { gravadas: 0, ignoradas: 0, falhas: [] }

  for (let i = 0; i < pendentes.length; i++) {
    const exec = pendentes[i]
    const r = await enviarExecucao(exec.id, endpoint)
    if (r.ok) resultado.gravadas++
    else resultado.falhas.push({ id: exec.id, codigo: exec.codigo, erro: r.erro ?? 'erro desconhecido' })
    aoProgredir?.(i + 1, pendentes.length)
  }

  return resultado
}

/** Busca o núcleo instalado de um equipamento direto da fonte (SharePoint), se houver endpoint. */
export async function lerNucleoDoServidor(
  endpoint: string,
  equipamento: string,
): Promise<string | null> {
  try {
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}equipamento=${encodeURIComponent(equipamento)}`
    const resposta = await fetch(url, { headers: cabecalhos({ Accept: 'application/json' }) })
    if (!resposta.ok) return null
    const dados = (await resposta.json()) as { nucleoInstalado?: string | null }
    return dados.nucleoInstalado?.trim() || null
  } catch {
    return null
  }
}

/** Item avaliado, pronto para o fluxo apenas transportar (sem recalcular limites). */
function mapearValores(
  exec: { marca?: Marca; valores: { itemId: string; valor: string; observacao?: string }[] },
  ficha: DefinicaoFicha | undefined,
): ExecucaoExportada['valores'] {
  return exec.valores.map((v) => {
    const item = ficha?.itens.find((i) => i.id === v.itemId)
    const analise = item ? avaliarItem(item, v.valor, exec.marca) : null
    return {
      itemId: v.itemId,
      itemNome: item?.nome ?? v.itemId,
      valor: v.valor,
      observacao: v.observacao,
      resultado: traduzirResultado(analise?.resultado),
      unidade: item?.unidade,
      limite: item ? limiteExibido(item, exec.marca) : undefined,
    }
  })
}

function traduzirResultado(
  r: 'conforme' | 'nao_conforme' | 'na' | 'vazio' | undefined,
): ResultadoExportado {
  return r === 'conforme' || r === 'nao_conforme' || r === 'na' ? r : 'na'
}

export function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => {
      const resultado = String(leitor.result ?? '')
      resolve(resultado.slice(resultado.indexOf(',') + 1))
    }
    leitor.onerror = () => reject(new Error('Falha ao ler a foto'))
    leitor.readAsDataURL(blob)
  })
}

export function base64ParaBlob(base64: string, mime: string): Blob {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function detectarAparelho(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  return 'Navegador'
}

/* ------------------------- administração (cadastros) ----------------------- */

/**
 * Cadastros e exclusão de execução só passam pelo serviço de administração, com
 * senha. O app não envia cadastro pelo endpoint comum: assim um aparelho
 * comprometido não altera a equipe nem apaga histórico no SharePoint.
 */
function cabecalhosAdmin(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = localStorage.getItem('fichas:syncToken')
    if (token && token.trim()) base.Authorization = `Bearer ***)}`
  } catch {
    /* localStorage indisponível */
  }
  return base
}

export interface RespostaAdmin {
  ok: boolean
  versao?: number
  erro?: string
}

async function postAdmin(
  endpoint: string,
  caminho: string,
  corpo: unknown,
): Promise<RespostaAdmin> {
  const base = endpoint.replace(/\/$/, '')
  try {
    const r = await fetch(`${base}${caminho}`, {
      method: 'POST',
      headers: cabecalhosAdmin(),
      body: JSON.stringify(corpo),
    })
    const dados = (await r.json().catch(() => ({}))) as RespostaAdmin & { erro?: string }
    if (!r.ok) return { ok: false, erro: dados.erro ?? `HTTP ${r.status}` }
    return { ok: true, versao: dados.versao }
  } catch (e) {
    return { ok: false, erro: `Sem conexão com ${base}: ${(e as Error).message}` }
  }
}

export const enviarPessoas = (endpoint: string, pessoas: unknown[]) =>
  postAdmin(endpoint, '/admin/pessoas', { pessoas })

export const enviarEquipamentos = (endpoint: string, equipamentos: unknown[]) =>
  postAdmin(endpoint, '/admin/equipamentos', { equipamentos })

export const excluirExecucaoNoServidor = (endpoint: string, execucaoId: string) =>
  postAdmin(endpoint, `/admin/execucoes/${encodeURIComponent(execucaoId)}/excluir`, {})
