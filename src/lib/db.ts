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

export function gerarCodigo(prefixo: string, existentes: { codigo: string }[]): string {
  const hoje = new Date()
  const dia = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(
    hoje.getDate(),
  ).padStart(2, '0')}`
  const base = `${prefixo}-${dia}`
  const doDia = existentes.filter((e) => e.codigo.startsWith(base)).length
  return `${base}-${String(doDia + 1).padStart(3, '0')}`
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
