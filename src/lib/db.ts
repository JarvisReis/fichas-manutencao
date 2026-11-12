import Dexie, { type Table } from 'dexie'
import type { Execucao, Foto } from '../types'

/**
 * Banco local do app. Tudo é gravado aqui primeiro — a sincronização com o
 * SharePoint é uma etapa separada que só roda quando há rede.
 */
export class FichasDB extends Dexie {
  execucoes!: Table<Execucao, string>
  fotos!: Table<Foto, string>
  config!: Table<{ chave: string; valor: string }, string>

  constructor() {
    super('fichas-metro')
    this.version(1).stores({
      execucoes: 'id, codigo, fichaId, status, sincronizada, criadaEm, dataHora, atualizadaEm',
      fotos: 'id, execucaoId',
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

/** Comprime a foto no cliente antes de guardar (alvo < 300 KB). */
export async function comprimirImagem(arquivo: File, maxLargura = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, maxLargura / bitmap.width)
  const largura = Math.round(bitmap.width * escala)
  const altura = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível')
  ctx.drawImage(bitmap, 0, 0, largura, altura)
  bitmap.close?.()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.75),
  )
  if (!blob) throw new Error('Falha ao comprimir a imagem')
  return blob
}
