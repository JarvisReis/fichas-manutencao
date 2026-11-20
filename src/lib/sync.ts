import { db } from './db'
export { obterEndpointAdmin } from './db'
import { lerToken } from './auth'
import { getFicha } from '../config/fichas'
import { avaliarItem, limiteExibido } from './conformidade'
import { gravarEquipamentos, type Equipamento } from './cadastros'
import type { FichasAjustadas } from './fichasEditadas'
import type { DefinicaoFicha, Execucao, Marca } from '../types'

/**
 * Payload de uma execução, no formato que o app envia ao servidor.
 *
 * Contrato v3 (2026-11-18): fim do SharePoint e fim das fotos. Cada envio é UM
 * objeto de execução, gravado na tabela `execucoes` do Supabase. O núcleo
 * instalado/retirado continua sendo campo próprio — é a fonte da verdade do
 * vínculo núcleo↔contator.
 */
export type ResultadoExportado = 'conforme' | 'nao_conforme' | 'na'

export const FORMATO_ENVIO = 'fichas-execucao'
export const VERSAO_ENVIO = 3

/**
 * Quantas fichas o `/historico` traz por vez.
 *
 * O número não é detalhe: quando a resposta vem truncada neste limite, a
 * ausência de uma ficha local não significa que ela foi apagada no servidor —
 * significa que ficou fora da página. A reconciliação de exclusões usa esse
 * valor como trava.
 */
export const LIMITE_HISTORICO = 500

export interface ExecucaoExportada {
  formato: typeof FORMATO_ENVIO
  versao: typeof VERSAO_ENVIO
  /** chave de idempotência usada pelo fluxo (ExecucaoId) */
  id: string
  /** mesma chave, com o nome que o servidor de sync espera */
  client_id: string
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
}

/** Monta o payload de uma execução pronta para envio. */
export async function montarEnvio(execucaoId: string): Promise<ExecucaoExportada | null> {
  const exec = await db.execucoes.get(execucaoId)
  if (!exec) return null
  const ficha = getFicha(exec.fichaId)
  const valores = mapearValores(exec, ficha)
  const naoConformes = valores.filter((v) => v.resultado === 'nao_conforme').length

  return {
    formato: FORMATO_ENVIO,
    versao: VERSAO_ENVIO,
    id: exec.id,
    /**
     * O servidor lê `client_id` — é a chave de idempotência da tabela
     * `execucoes`. Sem ela o envio volta 400 ("execução sem client_id") e a
     * ficha nunca sai da fila, por mais que o técnico tente.
     */
    client_id: exec.id,
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
  }
}

/**
 * Cabeçalhos do envio de fichas.
 *
 * Usa o mesmo JWT do Supabase que o app usa para entrar — quem valida é o
 * servidor de sync. Antes esta função lia `fichas:syncToken`, chave da época em
 * que o envio era um proxy com token próprio; ela nunca é preenchida hoje, e o
 * POST seguia sem `Authorization`. O servidor respondia 401 e a ficha ficava
 * parada para sempre na fila.
 */
function cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = { ...extra }
  const token = lerToken() ?? ''
  if (token.trim()) base.Authorization = `Bearer ${token.trim()}`
  return base
}

export interface ResultadoEnvio {
  /** gravações efetivamente confirmadas pelo servidor */
  gravadas: number
  ignoradas: number
  falhas: { id: string; codigo: string; erro: string }[]
}

export interface ResultadoHistorico {
  ok: boolean
  baixadas: number
  /** fichas locais removidas porque não existem mais no servidor */
  removidas: number
  erro?: string
}

/**
 * Traz do servidor as fichas já encerradas e guarda no aparelho.
 *
 * A sincronização só subia. Quem preencheu no celular tinha a lista; o
 * computador do escritório abria a home sem recentes e sem histórico, porque o
 * IndexedDB dele nunca recebeu nada. O servidor é a fonte comum — aqui ele
 * devolve as fichas (as do próprio técnico; o administrador vê todas).
 *
 * Rascunho não desce de propósito: rascunho é trabalho em andamento no
 * aparelho de quem começou.
 */
export async function baixarHistorico(endpoint: string): Promise<ResultadoHistorico> {
  if (!lerToken()) return { ok: false, baixadas: 0, removidas: 0, erro: 'sem sessão' }
  try {
    const url = `${endpoint.replace(/\/$/, '')}/historico?limite=${LIMITE_HISTORICO}`
    const r = await fetch(url, { headers: cabecalhos() })
    if (r.status === 401 || r.status === 403) {
      return { ok: false, baixadas: 0, removidas: 0, erro: 'sem permissão' }
    }
    if (!r.ok) return { ok: false, baixadas: 0, removidas: 0, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { execucoes?: Execucao[]; equipamentos?: unknown[] }
    const lista = Array.isArray(dados.execucoes) ? dados.execucoes : []
    let baixadas = 0
    for (const remota of lista) {
      if (!remota?.id) continue
      const local = await db.execucoes.get(remota.id)
      // O local manda enquanto não sincronizou: é a ficha em andamento.
      if (local && !local.sincronizada) continue
      // Só sobrescreve se a versão do servidor for mais nova.
      if (local && Date.parse(local.atualizadaEm) > Date.parse(remota.atualizadaEm)) continue
      await db.execucoes.put(remota)
      baixadas++
    }
    // Equipamentos do servidor viram a lista local do aparelho. Sem isso a home
    // de um aparelho novo não tinha o que mostrar nem em que tocar.
    //
    // Lista vazia também é resposta: significa que o servidor não tem cadastro
    // nenhum, e insistir na lista antiga mantinha na tela o contator que já
    // tinha sido apagado lá. Apagar equipamento NO SERVIDOR é intenção do
    // administrador; guardar a cópia local não é "modo offline", é resíduo.
    if (Array.isArray(dados.equipamentos)) {
      await gravarEquipamentos(dados.equipamentos as Equipamento[])
    }
    return { ok: true, baixadas, removidas: await reconciliarExclusoes(lista), erro: undefined }
  } catch (e) {
    return { ok: false, baixadas: 0, removidas: 0, erro: (e as Error).message }
  }
}

/**
 * Remove daqui a ficha que não existe mais no servidor.
 *
 * O caso real: uma ficha concluída foi apagada no servidor e continuou para
 * sempre neste aparelho, na home, como se fosse trabalho válido — o mesmo
 * equipamento aparecia "concluído" aqui e "rascunho" no outro aparelho, e
 * ninguém sabia qual valia.
 *
 * Três travas para não apagar trabalho de ninguém:
 *  - só ficha que já sincronizou (`sincronizada`), porque o que ainda não subiu
 *    pode simplesmente não estar no servidor ainda;
 *  - só ficha fechada (concluída/pendente), que é o conjunto que o `/historico`
 *    devolve — rascunho não vinha na resposta, então sua ausência não diz nada;
 *  - só quando a resposta veio inteira (sem truncar no limite).
 */
async function reconciliarExclusoes(lista: Execucao[]): Promise<number> {
  const truncada = lista.length >= LIMITE_HISTORICO
  const noServidor = new Set(lista.map((e) => e.id))
  const locais = await db.execucoes.toArray()
  let removidas = 0
  for (const local of locais) {
    if (!deveRemoverLocal(local, noServidor, truncada)) continue
    await db.execucoes.delete(local.id)
    removidas++
  }
  return removidas
}

/**
 * A regra pura da reconciliação, separada da base para poder ser testada.
 *
 * Errar aqui apaga ficha de campo — é o tipo de erro que não tem desfazer.
 */
export function deveRemoverLocal(
  local: Pick<Execucao, 'id' | 'status' | 'sincronizada'>,
  idsDoServidor: Set<string>,
  respostaTruncada: boolean,
): boolean {
  if (respostaTruncada) return false
  if (!local.sincronizada) return false
  if (local.status === 'rascunho') return false
  return !idsDoServidor.has(local.id)
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

    const dados = (await resposta.json().catch(() => null)) as {
      recusado?: 'fechada' | 'autoria'
      client_id?: string
      status?: string
    } | null

    /**
     * Ficha já fechada no servidor: o rascunho daqui não vale mais.
     *
     * Acontece quando o mesmo serviço foi concluído em outro aparelho — antes o
     * rascunho voltava a subir e reabria a ficha concluída. Agora o rascunho
     * obsoleto para de tentar. Se ele não tem medição digitada, sai daqui
     * (lixo); se tem, fica marcado como encerrado em outro aparelho, porque
     * apagar medição de alguém não é decisão que o app tome sozinho.
     */
    if (dados?.recusado === 'fechada') {
      const local = await db.execucoes.get(execucaoId)
      const semMedicao = !local || local.valores.every((v) => !String(v.valor ?? '').trim())
      if (semMedicao) {
        await db.execucoes.delete(execucaoId)
      } else {
        await db.execucoes.update(execucaoId, {
          sincronizada: true,
          encerradaRemoto: true,
          atualizadaEm: new Date().toISOString(),
        })
      }
      return { ok: true }
    }

    if (dados?.recusado === 'autoria') {
      await db.execucoes.update(execucaoId, { sincronizada: true })
      return { ok: false, erro: 'ficha de outra pessoa: peça ao administrador corrigir' }
    }

    /**
     * Adota o id canônico do servidor.
     *
     * Dois aparelhos abrindo a mesma ficha geram ids diferentes; o servidor
     * escolhe um e devolve aqui. Sem adotar, o aparelho reenviava para sempre e
     * o histórico mostrava a mesma ficha duas vezes.
     */
    const canonico = dados?.client_id
    if (canonico && canonico !== execucaoId) {
      const local = await db.execucoes.get(execucaoId)
      if (local) {
        const jaExiste = await db.execucoes.get(canonico)
        const localMaisNovo =
          !jaExiste || Date.parse(local.atualizadaEm) >= Date.parse(jaExiste.atualizadaEm)
        if (localMaisNovo) {
          await db.execucoes.put({
            ...local,
            id: canonico,
            sincronizada: true,
            atualizadaEm: new Date().toISOString(),
          })
        }
        await db.execucoes.delete(execucaoId)
      }
      return { ok: true }
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

/** Busca o núcleo instalado de um equipamento direto da fonte (servidor), se houver endpoint. */
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

function detectarAparelho(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  return 'Navegador'
}

/* ------------------------- administração (cadastros) ----------------------- */

/**
 * Ajustes das fichas publicados no servidor.
 *
 * O ajuste define limite de medição, itens e nomes. Até aqui ele só existia no
 * aparelho de quem editava, então o limite revisado pelo administrador não
 * chegava em ninguém. Ficou pior do que "não sincronizar": cada técnico media
 * por uma régua diferente e o app não avisava.
 */
export async function baixarAjustesDeFichas(
  endpoint: string,
): Promise<{ ok: boolean; dados?: AjustesPublicados; erro?: string }> {
  if (!lerToken()) return { ok: false, erro: 'sem sessão' }
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, '')}/fichas-ajustes`, {
      headers: cabecalhos(),
    })
    if (r.status === 401 || r.status === 403) return { ok: false, erro: 'sem permissão' }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as AjustesPublicados
    return {
      ok: true,
      dados: {
        ajustes:
          dados.ajustes && typeof dados.ajustes === 'object' && !Array.isArray(dados.ajustes)
            ? dados.ajustes
            : {},
        atualizadoEm: dados.atualizadoEm ?? null,
        atualizadoPor: dados.atualizadoPor ?? null,
        autor: dados.autor ?? null,
      },
    }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}

/**
 * Publica os ajustes para a equipe. O servidor só aceita de administrador.
 *
 * Devolve o carimbo gravado lá para o aparelho autor saber que já está na
 * versão em vigor — sem isso ele baixaria a própria alteração na próxima
 * abertura e reescreveria o banco local sem motivo.
 */
export async function publicarAjustesDeFichas(
  endpoint: string,
  ajustes: FichasAjustadas,
): Promise<{ ok: boolean; atualizadoEm?: string; autor?: string | null; erro?: string }> {
  if (!lerToken()) return { ok: false, erro: 'sem sessão' }
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, '')}/fichas-ajustes`, {
      method: 'PUT',
      headers: cabecalhos({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ajustes }),
    })
    if (r.status === 403) return { ok: false, erro: 'só o administrador publica a ficha' }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { atualizadoEm?: string; autor?: string | null }
    return { ok: true, atualizadoEm: dados.atualizadoEm, autor: dados.autor ?? null }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}

/** Retrato do que o servidor tem publicado. */
export interface AjustesPublicados {
  ajustes: FichasAjustadas
  atualizadoEm: string | null
  atualizadoPor?: string | null
  /** nome de quem publicou, resolvido pelo servidor */
  autor?: string | null
}

/**
 * Cadastros e exclusão de execução só passam pelo serviço de administração, com
 * senha. O app não envia cadastro pelo endpoint comum: assim um aparelho
 * comprometido não altera a equipe nem apaga histórico no servidor.
 */
function cabecalhosAdmin(): Record<string, string> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  // O servidor de sync confere o JWT do Supabase, o mesmo que o app usa para
  // entrar. O token antigo (`fichas:syncToken`) era de quando o admin tinha
  // senha própria — não serve mais.
  const token = lerToken() ?? ''
  if (token.trim()) base.Authorization = `Bearer ${token.trim()}`
  return base
}

/**
 * Puxa a equipe do servidor.
 *
 * A lista de técnicos tem de valer para todo mundo, não só para o aparelho
 * onde foi digitada. O servidor devolve o que está em `perfis`; o aparelho
 * guarda a cópia local para continuar funcionando offline.
 */
export async function baixarEquipe(
  endpoint: string,
): Promise<{ ok: boolean; pessoas?: unknown[]; erro?: string; silencioso?: boolean }> {
  const base = endpoint.replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/equipe`, { headers: cabecalhosAdmin() })
    /**
     * Leitura liberada para qualquer usuário ativo; 401/403 aqui significa
     * conta sem perfil ou desativada. Não é falha a exibir: a lista local
     * continua valendo.
     */
    if (r.status === 401 || r.status === 403) return { ok: false, silencioso: true }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { pessoas?: unknown[] }
    return { ok: true, pessoas: dados.pessoas ?? [] }
  } catch (e) {
    return { ok: false, erro: `Sem conexão com ${base}: ${(e as Error).message}` }
  }
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

/**
 * Puxa a lista de equipamentos do servidor.
 *
 * O administrador publica; os outros aparelhos recebem. Sem isso um aparelho
 * novo ficava sem nenhum equipamento e o técnico não abria ficha.
 */
export async function baixarEquipamentos(
  endpoint: string,
): Promise<{ ok: boolean; equipamentos?: unknown[]; erro?: string; silencioso?: boolean }> {
  const base = endpoint.replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/equipamentos`, { headers: cabecalhosAdmin() })
    if (r.status === 401 || r.status === 403) return { ok: false, silencioso: true }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { equipamentos?: unknown[] }
    return { ok: true, equipamentos: dados.equipamentos ?? [] }
  } catch (e) {
    return { ok: false, erro: `Sem conexão com ${base}: ${(e as Error).message}` }
  }
}

export const excluirExecucaoNoServidor = (endpoint: string, execucaoId: string) =>
  postAdmin(endpoint, `/admin/execucoes/${encodeURIComponent(execucaoId)}/excluir`, {})

/**
 * Manda a cópia de segurança do aparelho para o servidor.
 *
 * O dado vive no IndexedDB, e "limpar cache" apaga tudo sem aviso — foi assim
 * que uma ficha inteira se perdeu: nunca subiu, existia só no navegador, e o
 * técnico limpou o cache. Aqui o pacote completo (execuções + cadastros) fica
 * guardado no servidor, fora do alcance do navegador.
 *
 * Falha em silêncio de propósito: backup não pode virar erro na cara do técnico
 * nem travar a sincronização. Quem quiser conferir tem a tela de backup.
 */
export async function enviarBackupAutomatico(
  endpoint: string,
  pacote: unknown,
): Promise<{ ok: boolean; ignorado?: string; erro?: string }> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, '')}/backups`, {
      method: 'POST',
      headers: cabecalhos({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ origem: 'auto', aparelho: detectarAparelho(), conteudo: pacote }),
    })
    if (r.status === 401 || r.status === 403) return { ok: false, erro: 'sem permissão' }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { ignorado?: string }
    return { ok: true, ignorado: dados.ignorado }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}

/** Lista os backups guardados no servidor (só administrador). */
export async function listarBackups(
  endpoint: string,
): Promise<{ ok: boolean; backups?: unknown[]; erro?: string }> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, '')}/backups`, { headers: cabecalhos() })
    if (r.status === 401 || r.status === 403) return { ok: false, erro: 'sem permissão' }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { backups?: unknown[] }
    return { ok: true, backups: dados.backups ?? [] }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}

/** Baixa o conteúdo de um backup do servidor para restauração. */
export async function baixarBackup(
  endpoint: string,
  id: number,
): Promise<{ ok: boolean; conteudo?: unknown; erro?: string }> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, '')}/backups/${id}`, {
      headers: cabecalhos(),
    })
    if (r.status === 401 || r.status === 403) return { ok: false, erro: 'sem permissão' }
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` }
    const dados = (await r.json()) as { conteudo?: unknown }
    return { ok: true, conteudo: dados.conteudo }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}
