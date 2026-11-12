#!/usr/bin/env node
/**
 * Serviço de sincronização das fichas.
 *
 * Recebe POST /fichas com UMA execução (formato `fichas-execucao` v2),
 * grava nas listas do SharePoint via Graph API usando as credenciais da
 * App Registration (client credentials + Sites.Selected — sem usuário logado).
 *
 * GET /fichas?equipamento=CT%2002 — devolve o núcleo instalado atual daquele
 * contator, para o app preencher a P1 somente-leitura de qualquer aparelho.
 *
 * Variáveis de ambiente (arquivo /etc/fichas-sync.env):
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET
 *   SITE_HOST      ex.: metrosp.sharepoint.com
 *   SITE_PATH      ex.: /sites/Fichas
 *   LIST_EXECUCOES ex.: FichasExecucoes
 *   LIST_CONTATORES ex.: Contatores
 *   PORT           padrão 8787
 *   SYNC_TOKEN     (opcional) se definido, exige Authorization: Bearer <token>
 */
import http from 'node:http'

const {
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  SITE_HOST,
  SITE_PATH,
  LIST_EXECUCOES = 'FichasExecucoes',
  LIST_CONTATORES = 'Contatores',
  PORT = '8787',
  SYNC_TOKEN = '',
} = process.env

const faltando = ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SITE_HOST', 'SITE_PATH'].filter(
  (k) => !process.env[k],
)
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}`)
  process.exit(1)
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
let cacheToken = { valor: '', expira: 0 }
let cacheSite = { id: '', listas: new Map() }

async function tokenGraph() {
  if (cacheToken.valor && Date.now() < cacheToken.expira - 60_000) return cacheToken.valor
  const corpo = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r.ok) throw new Error(`Token Graph falhou: ${r.status} ${await r.text()}`)
  const dados = await r.json()
  cacheToken = { valor: dados.access_token, expira: Date.now() + dados.expires_in * 1000 }
  return cacheToken.valor
}

async function graph(caminho, opcoes = {}) {
  const token = await tokenGraph()
  const r = await fetch(`${GRAPH}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers ?? {}),
    },
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`Graph ${opcoes.method ?? 'GET'} ${caminho}: ${r.status} ${texto}`)
  return texto ? JSON.parse(texto) : {}
}

async function idDoSite() {
  if (cacheSite.id) return cacheSite.id
  const site = await graph(`/sites/${SITE_HOST}:${SITE_PATH}`)
  cacheSite.id = site.id
  return site.id
}

async function idDaLista(nome) {
  if (cacheSite.listas.has(nome)) return cacheSite.listas.get(nome)
  const siteId = await idDoSite()
  const lista = await graph(`/sites/${siteId}/lists/${encodeURIComponent(nome)}`)
  cacheSite.listas.set(nome, lista.id)
  return lista.id
}

/** Converte o payload do app nas colunas da lista FichasExecucoes. */
function camposDaExecucao(p) {
  return {
    Title: p.codigo,
    ExecucaoId: p.id,
    FichaId: p.fichaId,
    FichaNome: p.fichaNome,
    Equipamento: p.equipamento ?? '',
    TipoManutencao: p.tipoManutencao ?? '',
    Marca: p.marca ?? '',
    NucleoInstalado: p.nucleoInstalado ?? '',
    NucleoRetirado: p.nucleoRetirado ?? '',
    Local: p.local ?? '',
    DataHora: p.dataHora,
    Status: p.status ?? '',
    ObservacaoGeral: p.observacaoGeral ?? '',
    NaoConformes: p.naoConformes ?? 0,
    MedicoesJson: JSON.stringify(p.valores ?? []),
    FotosJson: JSON.stringify((p.fotos ?? []).map((f) => ({ itemId: f.itemId, mime: f.mime }))),
    Aparelho: p.aparelho ?? '',
  }
}

/**
 * Procura a execução já gravada. Devolve o item (id + status) ou null.
 * Serve para duas coisas: idempotência e recusa de alteração de ficha fechada.
 */
async function localizarExecucao(listaId, execucaoId) {
  const r = await graph(
    `/sites/${await idDoSite()}/lists/${listaId}/items?$filter=${encodeURIComponent(
      `fields/ExecucaoId eq '${execucaoId}'`,
    )}&$expand=fields($select=id,Status)&$top=1`,
  )
  const item = r.value?.[0]
  if (!item) return null
  return { id: item.id, status: item.fields?.Status ?? '' }
}

/**
 * Execução concluída é registro fechado no SharePoint: só administrador altera.
 *
 * Bloqueio vale para envio de ficha fechada que já existe na lista. O app manda
 * `reenvioAdmin: true` quando quem corrigiu se identificou como administrador;
 * sem essa marca, a linha existente manda — reenvio de aparelho de campo é
 * recusado com 409, e o app avisa em vez de fingir que sincronizou.
 */
async function gravarExecucao(p) {
  const listaId = await idDaLista(LIST_EXECUCOES)
  const existente = await localizarExecucao(listaId, p.id)
  if (existente) {
    const fechada = existente.status === 'concluida'
    if (fechada && !p.reenvioAdmin) {
      return { criado: false, recusado: 'concluida' }
    }
    // Concluída reaberta por administrador: atualiza as colunas da execução.
    if (p.reenvioAdmin) {
      const siteId = await idDoSite()
      await graph(`/sites/${siteId}/lists/${listaId}/items/${existente.id}/fields`, {
        method: 'PATCH',
        body: JSON.stringify(camposDaExecucao(p)),
      })
      if (p.tipoManutencao === 'P2' && p.nucleoInstalado && p.equipamento) {
        await atualizarContator(p.equipamento, p.nucleoInstalado)
      }
      return { criado: false, atualizado: true }
    }
    return { criado: false }
  }

  const siteId = await idDoSite()
  await graph(`/sites/${siteId}/lists/${listaId}/items`, {
    method: 'POST',
    body: JSON.stringify({ fields: camposDaExecucao(p) }),
  })

  // P2: o núcleo que entrou no contator passa a ser o instalado da lista Contatores.
  if (p.tipoManutencao === 'P2' && p.nucleoInstalado && p.equipamento) {
    await atualizarContator(p.equipamento, p.nucleoInstalado)
  }
  return { criado: true }
}

async function atualizarContator(equipamento, nucleoInstalado) {
  try {
    const listaId = await idDaLista(LIST_CONTATORES)
    const siteId = await idDoSite()
    const r = await graph(
      `/sites/${siteId}/lists/${listaId}/items?$filter=${encodeURIComponent(
        `fields/Title eq '${equipamento.replace(/'/g, "''")}'`,
      )}&$expand=fields($select=id)&$top=1`,
    )
    const item = r.value?.[0]
    if (!item) return
    await graph(`/sites/${siteId}/lists/${listaId}/items/${item.id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify({ NucleoInstalado: nucleoInstalado }),
    })
  } catch (e) {
    console.warn(`Não foi possível atualizar a lista Contatores: ${e.message}`)
  }
}

async function nucleoDoContator(equipamento) {
  const listaId = await idDaLista(LIST_CONTATORES)
  const siteId = await idDoSite()
  const r = await graph(
    `/sites/${siteId}/lists/${listaId}/items?$filter=${encodeURIComponent(
      `fields/Title eq '${equipamento.replace(/'/g, "''")}'`,
    )}&$expand=fields($select=NucleoInstalado)&$top=1`,
  )
  const campos = r.value?.[0]?.fields
  return { nucleoInstalado: campos?.NucleoInstalado ?? null }
}

function json(res, status, dados) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(dados))
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') return json(res, 204, {})

  if (SYNC_TOKEN) {
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${SYNC_TOKEN}`) return json(res, 401, { erro: 'não autorizado' })
  }

  try {
    if (req.method === 'GET' && url.pathname === '/fichas') {
      const equipamento = url.searchParams.get('equipamento')?.trim()
      if (!equipamento) return json(res, 400, { erro: 'informe ?equipamento=' })
      return json(res, 200, await nucleoDoContator(equipamento))
    }

    if (req.method === 'GET' && url.pathname === '/saude') {
      await tokenGraph()
      await idDoSite()
      return json(res, 200, { ok: true, site: cacheSite.id })
    }

    if (req.method === 'POST' && url.pathname === '/fichas') {
      const partes = []
      for await (const parte of req) partes.push(parte)
      const payload = JSON.parse(Buffer.concat(partes).toString('utf8'))

      if (payload.formato !== 'fichas-execucao') {
        return json(res, 400, { erro: 'formato não reconhecido' })
      }
      if (!payload.id) return json(res, 400, { erro: 'execução sem id' })

      const r = await gravarExecucao(payload)
      if (r.recusado === 'concluida') {
        console.log(`recusada ${payload.codigo} (${payload.id}): concluída no SharePoint`)
        return json(res, 409, {
          ok: false,
          erro: 'execução já concluída no SharePoint; correção exige administrador',
        })
      }
      console.log(
        `${r.criado ? 'gravada' : r.atualizado ? 'atualizada' : 'ignorada'} ${payload.codigo} (${payload.id})`,
      )
      return json(res, r.criado ? 201 : 200, { ok: true, ...r })
    }

    return json(res, 404, { erro: 'rota inexistente' })
  } catch (e) {
    console.error(e.message)
    return json(res, 500, { erro: e.message })
  }
})

servidor.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`fichas-sync ouvindo em 0.0.0.0:${PORT}`)
})
