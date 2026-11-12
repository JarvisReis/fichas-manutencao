import { db } from './db'
import { getFicha } from '../config/fichas'
import { avaliarItem, limiteExibido } from './conformidade'
import type { DefinicaoFicha, Marca } from '../types'

export type ResultadoExportado = 'conforme' | 'nao_conforme' | 'na'

export interface PacoteBackup {
  formato: 'fichas-metro-backup'
  versao: 1
  exportadoEm: string
  aparelho: string
  execucoes: {
    id: string
    codigo: string
    fichaId: string
    fichaNome: string
    marca?: string
    tipoManutencao?: string
    local: string
    cabecalho: Record<string, string>
    camposFixos: Record<string, string>
    dataHora: string
    dataFim?: string
    status: string
    sincronizada: boolean
    observacaoGeral?: string
    valores: {
      itemId: string
      itemNome: string
      valor: string
      observacao?: string
      /** veredito ja calculado pelo app, para o fluxo so transportar */
      resultado: ResultadoExportado
      unidade?: string
      limite?: string
    }[]
  }[]
  fotos: { id: string; execucaoId: string; itemId: string; base64: string; mime: string }[]
}

/** Lê tudo do IndexedDB e monta o pacote de backup (JSON serializável). */
export async function montarBackup(): Promise<PacoteBackup> {
  const execucoes = await db.execucoes.toArray()
  const fotos = await db.fotos.toArray()

  const fotosSerializadas: PacoteBackup['fotos'] = []
  for (const foto of fotos) {
    fotosSerializadas.push({
      id: foto.id,
      execucaoId: foto.execucaoId,
      itemId: foto.itemId,
      mime: foto.blob.type || 'image/jpeg',
      base64: await blobParaBase64(foto.blob),
    })
  }

  return {
    formato: 'fichas-metro-backup',
    versao: 1,
    exportadoEm: new Date().toISOString(),
    aparelho: detectarAparelho(),
    execucoes: execucoes.map((exec) => {
      const ficha = getFicha(exec.fichaId)
      return {
        id: exec.id,
        codigo: exec.codigo,
        fichaId: exec.fichaId,
        fichaNome: ficha?.nome ?? exec.fichaId,
        marca: exec.marca,
        tipoManutencao: exec.tipoManutencao,
        local: exec.local,
        cabecalho: exec.cabecalho,
        camposFixos: exec.camposFixos,
        dataHora: exec.dataHora,
        dataFim: exec.dataFim,
        status: exec.status,
        sincronizada: exec.sincronizada,
        observacaoGeral: exec.observacaoGeral,
        valores: mapearValores(exec, ficha),
      }
    }),
    fotos: fotosSerializadas,
  }
}

/** Monta o pacote de UMA execução, no mesmo formato que o fluxo do Power Automate lê. */
export async function montarPacoteExecucao(execucaoId: string): Promise<PacoteBackup | null> {
  const exec = await db.execucoes.get(execucaoId)
  if (!exec) return null
  const ficha = getFicha(exec.fichaId)
  const fotos = await db.fotos.where('execucaoId').equals(execucaoId).toArray()

  const fotosSerializadas: PacoteBackup['fotos'] = []
  for (const foto of fotos) {
    fotosSerializadas.push({
      id: foto.id,
      execucaoId: foto.execucaoId,
      itemId: foto.itemId,
      mime: foto.blob.type || 'image/jpeg',
      base64: await blobParaBase64(foto.blob),
    })
  }

  return {
    formato: 'fichas-metro-backup',
    versao: 1,
    exportadoEm: new Date().toISOString(),
    aparelho: detectarAparelho(),
    execucoes: [
      {
        id: exec.id,
        codigo: exec.codigo,
        fichaId: exec.fichaId,
        fichaNome: ficha?.nome ?? exec.fichaId,
        marca: exec.marca,
        tipoManutencao: exec.tipoManutencao,
        local: exec.local,
        cabecalho: exec.cabecalho,
        camposFixos: exec.camposFixos,
        dataHora: exec.dataHora,
        dataFim: exec.dataFim,
        status: exec.status,
        sincronizada: exec.sincronizada,
        observacaoGeral: exec.observacaoGeral,
        valores: mapearValores(exec, ficha),
      },
    ],
    fotos: fotosSerializadas,
  }
}

/**
 * Nome de arquivo seguro. A identificação agora é "CT 02 · 12/11/2026", que tem
 * espaço, ponto central e barras — tudo proibido em nome de arquivo.
 */
function nomeDoArquivo(codigo: string, dataHora: string): string {
  const limpo = codigo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `FICHAS-METRO_${limpo}_${dataHora.slice(0, 10)}.json`
}

/** Exporta uma execucao sozinha, com nome de arquivo rastreavel. */
export async function exportarExecucao(execucaoId: string): Promise<{ nome: string; bytes: number }> {
  const pacote = await montarPacoteExecucao(execucaoId)
  if (!pacote) throw new Error('Execucao nao encontrada')
  const exec = pacote.execucoes[0]
  const json = JSON.stringify(pacote, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const nome = nomeDoArquivo(exec.codigo, exec.dataHora)
  baixarBlob(blob, nome)
  return { nome, bytes: blob.size }
}

/** Compartilha uma execucao pelo menu nativo (para salvar no OneDrive/SharePoint). */
export async function compartilharExecucao(execucaoId: string): Promise<boolean> {
  const pacote = await montarPacoteExecucao(execucaoId)
  if (!pacote) throw new Error('Execucao nao encontrada')
  const exec = pacote.execucoes[0]
  const json = JSON.stringify(pacote, null, 2)
  const nome = nomeDoArquivo(exec.codigo, exec.dataHora)
  const arquivo = new File([json], nome, { type: 'application/json' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [arquivo] })) {
    await navigator.share({
      files: [arquivo],
      title: `Ficha ${exec.codigo}`,
      text: `${exec.fichaNome} - ${exec.local}`,
    })
    return true
  }
  return false
}

/** Gera o arquivo e dispara o download. */
export async function exportarBackup(): Promise<{ execucoes: number; fotos: number; bytes: number }> {
  const pacote = await montarBackup()
  const json = JSON.stringify(pacote, null, 2)
  const blob = new Blob([json], { type: 'application/json' })

  const nome = `fichas-metro-backup-${new Date().toISOString().slice(0, 10)}.json`
  baixarBlob(blob, nome)

  return { execucoes: pacote.execucoes.length, fotos: pacote.fotos.length, bytes: blob.size }
}

/** Compartilha o arquivo pelo menu nativo do celular (quando disponível). */
export async function compartilharBackup(): Promise<boolean> {
  const pacote = await montarBackup()
  const json = JSON.stringify(pacote, null, 2)
  const nome = `fichas-metro-backup-${new Date().toISOString().slice(0, 10)}.json`
  const arquivo = new File([json], nome, { type: 'application/json' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [arquivo] })) {
    await navigator.share({
      files: [arquivo],
      title: 'Backup Fichas Metrô',
      text: `${pacote.execucoes.length} execução(ões) · ${pacote.fotos.length} foto(s)`,
    })
    return true
  }
  return false
}

/** Restaura um pacote exportado. Não sobrescreve execuções existentes. */
export async function importarBackup(texto: string): Promise<{
  execucoes: number
  fotos: number
  ignoradas: number
}> {
  const pacote = JSON.parse(texto) as PacoteBackup
  if (pacote.formato !== 'fichas-metro-backup') {
    throw new Error('Arquivo não é um backup do Fichas Metrô.')
  }

  let importadas = 0
  let ignoradas = 0

  for (const exec of pacote.execucoes) {
    const existente = await db.execucoes.get(exec.id)
    if (existente) {
      ignoradas++
      continue
    }
    const agora = new Date().toISOString()
    await db.execucoes.put({
      id: exec.id,
      codigo: exec.codigo,
      fichaId: exec.fichaId,
      marca: exec.marca as never,
      tipoManutencao: exec.tipoManutencao as never,
      cabecalho: exec.cabecalho,
      camposFixos: exec.camposFixos,
      local: exec.local,
      dataHora: exec.dataHora,
      valores: exec.valores.map((v) => ({
        itemId: v.itemId,
        valor: v.valor,
        observacao: v.observacao,
      })),
      observacaoGeral: exec.observacaoGeral,
      status: (exec.status as 'rascunho' | 'concluida') ?? 'concluida',
      sincronizada: false,
      criadaEm: agora,
      atualizadaEm: agora,
    })
    importadas++
  }

  let fotosImportadas = 0
  for (const foto of pacote.fotos ?? []) {
    const existente = await db.fotos.get(foto.id)
    if (existente) continue
    await db.fotos.put({
      id: foto.id,
      execucaoId: foto.execucaoId,
      itemId: foto.itemId,
      blob: base64ParaBlob(foto.base64, foto.mime),
      criadaEm: new Date().toISOString(),
    })
    fotosImportadas++
  }

  return { execucoes: importadas, fotos: fotosImportadas, ignoradas }
}

/** Item avaliado, pronto para o Power Automate apenas transportar (sem recalcular limites). */
function mapearValores(
  exec: { marca?: Marca; valores: { itemId: string; valor: string; observacao?: string }[] },
  ficha: DefinicaoFicha | undefined,
): PacoteBackup['execucoes'][number]['valores'] {
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

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function blobParaBase64(blob: Blob): Promise<string> {
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

function base64ParaBlob(base64: string, mime: string): Blob {
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
