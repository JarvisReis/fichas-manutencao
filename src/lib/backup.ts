import { db } from './db'
import { getFicha } from '../config/fichas'
import { avaliarItem, limiteExibido } from './conformidade'
import {
  chaveDoEquipamento,
  gravarEquipamentos,
  gravarPessoas,
  lerEquipamentos,
  lerPessoas,
  semEquipamentosRepetidos,
  type Equipamento,
  type Pessoa,
} from './cadastros'
import type { DefinicaoFicha, Marca } from '../types'

export type ResultadoExportado = 'conforme' | 'nao_conforme' | 'na'

export interface PacoteBackup {
  /** `fichas-metro-backup` é o rótulo antigo — ainda aceito na importação. */
  formato: 'fichas-backup' | 'fichas-metro-backup'
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
  /**
   * Cadastros do aparelho. Opcional porque backups gerados antes desta versão
   * não os tinham — nesses, a importação traz só as fichas.
   */
  cadastros?: {
    equipamentos: Equipamento[]
    pessoas: Pessoa[]
  }
}

/** Lê tudo do IndexedDB e monta o pacote de backup (JSON serializável). */
export async function montarBackup(): Promise<PacoteBackup> {
  const execucoes = await db.execucoes.toArray()
  const equipamentos = await lerEquipamentos()
  const pessoas = await lerPessoas()

  return {
    formato: 'fichas-backup',
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
    cadastros: { equipamentos, pessoas },
  }
}

/** Monta o pacote de UMA execução, no mesmo formato do envio ao servidor. */
export async function montarPacoteExecucao(execucaoId: string): Promise<PacoteBackup | null> {
  const exec = await db.execucoes.get(execucaoId)
  if (!exec) return null
  const ficha = getFicha(exec.fichaId)

  return {
    formato: 'fichas-backup',
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
  return `FICHAS_${limpo}_${dataHora.slice(0, 10)}.json`
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

/** Compartilha uma execucao pelo menu nativo do celular. */
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
export async function exportarBackup(): Promise<{ execucoes: number; bytes: number }> {
  const pacote = await montarBackup()
  const json = JSON.stringify(pacote, null, 2)
  const blob = new Blob([json], { type: 'application/json' })

  const nome = `fichas-backup-${new Date().toISOString().slice(0, 10)}.json`
  baixarBlob(blob, nome)

  return { execucoes: pacote.execucoes.length, bytes: blob.size }
}

/** Compartilha o arquivo pelo menu nativo do celular (quando disponível). */
export async function compartilharBackup(): Promise<boolean> {
  const pacote = await montarBackup()
  const json = JSON.stringify(pacote, null, 2)
  const nome = `fichas-backup-${new Date().toISOString().slice(0, 10)}.json`
  const arquivo = new File([json], nome, { type: 'application/json' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [arquivo] })) {
    await navigator.share({
      files: [arquivo],
      title: 'Backup das fichas',
      text: `${pacote.execucoes.length} execução(ões) e os cadastros`, 
    })
    return true
  }
  return false
}

/**
 * Restaura um pacote já em memória.
 *
 * Separado de `importarBackup` porque o pacote agora chega de dois lugares: do
 * arquivo que o técnico escolhe e do backup guardado no servidor. O trabalho é
 * o mesmo — não faz sentido ter duas restaurações com regras que divergem com
 * o tempo.
 */
export async function restaurarPacote(pacote: PacoteBackup): Promise<{
  execucoes: number
  ignoradas: number
  equipamentos: number
  pessoas: number
}> {
  // Aceita o rótulo antigo: backups gerados antes da troca de nome ficaram com
  // `fichas-metro-backup` gravado no arquivo. Recusar seria apagar o histórico
  // de quem já tinha backup na mão.
  if (pacote.formato !== 'fichas-backup' && pacote.formato !== 'fichas-metro-backup') {
    throw new Error('Arquivo não é um backup das fichas.')
  }

  // Cadastros primeiro: os cartões de equipamento dependem deles para mostrar
  // nome, local e ficha. Backup antigo (sem o bloco) não apaga o que já existe.
  let equipamentosImportados = 0
  let pessoasImportadas = 0
  if (pacote.cadastros) {
    const equipAtuais = await lerEquipamentos()
    const chavesAtuais = new Set(equipAtuais.map(chaveDoEquipamento))
    // Duas linhas com o mesmo nome no próprio backup também caem fora: um
    // backup feito enquanto a duplicata existia a recriava inteira aqui.
    const candidatos = semEquipamentosRepetidos(pacote.cadastros.equipamentos ?? [])
    const novosEquip = candidatos.filter((e) => !chavesAtuais.has(chaveDoEquipamento(e)))
    if (novosEquip.length > 0) {
      await gravarEquipamentos([...equipAtuais, ...novosEquip])
      equipamentosImportados = novosEquip.length
    }

    const pessoasAtuais = await lerPessoas()
    // RG é a identidade da pessoa no app: mesmo RG não entra duas vezes.
    const rgsAtuais = new Set(pessoasAtuais.map((p) => p.rg.trim()))
    const novasPessoas = (pacote.cadastros.pessoas ?? []).filter(
      (p) => !rgsAtuais.has(p.rg.trim()),
    )
    if (novasPessoas.length > 0) {
      await gravarPessoas([...pessoasAtuais, ...novasPessoas])
      pessoasImportadas = novasPessoas.length
    }
  }

  // Backups antigos não traziam cadastros. O nome do equipamento, porém, está
  // dentro de cada ficha — dá para reconstruir o cadastro básico com o que a
  // própria execução registrou, em vez de o técnico digitar tudo de novo.
  let equipamentosDasFichas = 0
  {
    const atuais = await lerEquipamentos()
    const porNome = new Set(atuais.map(chaveDoEquipamento))
    const criados: Equipamento[] = []
    for (const exec of pacote.execucoes) {
      const nome = (exec.camposFixos?.equipamento ?? '').trim()
      if (!nome) continue
      const chave = chaveDoEquipamento({ nome } as Equipamento)
      if (porNome.has(chave)) continue
      porNome.add(chave)
      criados.push({
        id: crypto.randomUUID(),
        nome,
        fichaId: exec.fichaId,
        local: (exec.local ?? '').trim(),
        marca: exec.marca,
        serie: exec.camposFixos?.serieInstalado,
      })
    }
    if (criados.length > 0) {
      await gravarEquipamentos([...atuais, ...criados])
      equipamentosDasFichas = criados.length
    }
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

  return {
    execucoes: importadas,
    ignoradas,
    equipamentos: equipamentosImportados + equipamentosDasFichas,
    pessoas: pessoasImportadas,
  }
}

/**
 * Restaura a partir do texto de um arquivo de backup.
 *
 * Mantido como porta de entrada porque a tela de backup e os backups antigos
 * já falam esta língua: aqui só se lê o JSON e se entrega ao trabalho comum.
 */
export async function importarBackup(texto: string): Promise<{
  execucoes: number
  ignoradas: number
  equipamentos: number
  pessoas: number
}> {
  return restaurarPacote(JSON.parse(texto) as PacoteBackup)
}

/** Item avaliado, já com o veredito calculado (o servidor não recalcula limites). */
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

function detectarAparelho(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  return 'Navegador'
}
