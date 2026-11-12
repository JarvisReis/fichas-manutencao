#!/usr/bin/env node
/**
 * Posto de administração das Fichas Metrô.
 *
 * O servidor de sync aceita execuções de qualquer aparelho com o token comum da
 * equipe. Cadastros (pessoas e equipamentos) e exclusão de execução NÃO são
 * operação de campo: só passam aqui, com a senha de administrador.
 *
 *   POST /admin/pessoas       { pessoas: Pessoa[] }
 *   POST /admin/equipamentos  { equipamentos: Equipamento[] }
 *   POST /admin/execucoes/:id/excluir   { aparelho? }
 *   GET  /admin/estado        → { admin: true, pessoas: n, equipamentos: n, versao }
 *
 * Toda alteração de cadastro sobe a versão e é gravada em
 *   CadastrosVersao / PessoasJson / EquipamentosJson na lista de configuração,
 * e o app só aceita um conjunto de cadastros se a versão for >= a que ele já tem.
 *
 * Variáveis (mesmo /etc/fichas-sync.env do sync-server):
 *   ADMIN_PASSWORD   obrigatório; sem ele o serviço não sobe
 *   ADMIN_PORT       padrão 8788
 *   LIST_CONFIG      padrão ConfigFichas
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SITE_HOST, SITE_PATH
 */
import http from 'node:http'
import crypto from 'node:crypto'

const {
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  SITE_HOST,
  SITE_PATH,
  LIST_CONFIG = 'ConfigFichas',
  LIST_EXECUCOES = 'FichasExecucoes',
  ADMIN_PASSWORD = '',
  ADMIN_PORT = '8788',
} = process.env

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('Defina ADMIN_PASSWORD (mínimo 8 caracteres) no /etc/fichas-sync.env')
  process.exit(1)
}

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
  if (!r.ok) throw new Error(`Token Graph falhou: ${r.status}`)
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

/* ---------------------------------- senha --------------------------------- */

/**
 * Comparação em tempo constante. O hash é derivado por requisição para que o
 * tempo não dependa de quantos caracteres bateram.
 */
function senhaConfere(recebida) {
  const a = crypto.createHash('sha256').update(String(recebida ?? '')).digest()
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest()
  return crypto.timingSafeEqual(a, b)
}

/* ------------------------------- configuração ------------------------------ */

/** Item único da lista ConfigFichas: versão + cadastros em JSON. */
async function lerConfig() {
  const listaId = await idDaLista(LIST_CONFIG)
  const siteId = await idDoSite()
  const r = await graph(
    `/sites/${siteId}/lists/${listaId}/items?$expand=fields&$top=1`,
  )
  const item = r.value?.[0]
  if (!item) return { itemId: null, versao: 0, pessoas: [], equipamentos: [] }
  const f = item.fields ?? {}
  return {
    itemId: item.id,
    versao: Number(f.CadastrosVersao ?? 0),
    pessoas: parseJson(f.PessoasJson, []),
    equipamentos: parseJson(f.EquipamentosJson, []),
  }
}

function parseJson(texto, padrao) {
  try {
    const v = JSON.parse(texto ?? '')
    return Array.isArray(v) ? v : padrao
  } catch {
    return padrao
  }
}

async function gravarConfig(atual, patch) {
  const listaId = await idDaLista(LIST_CONFIG)
  const siteId = await idDoSite()
  const campos = {
    Title: 'config',
    CadastrosVersao: atual.versao + 1,
    PessoasJson: JSON.stringify(patch.pessoas ?? atual.pessoas),
    EquipamentosJson: JSON.stringify(patch.equipamentos ?? atual.equipamentos),
    AlteradoEm: new Date().toISOString(),
  }
  if (atual.itemId) {
    await graph(`/sites/${siteId}/lists/${listaId}/items/${atual.itemId}/fields`, {
      method: 'PATCH',
      body: JSON.stringify(campos),
    })
  } else {
    await graph(`/sites/${siteId}/lists/${listaId}/items`, {
      method: 'POST',
      body: JSON.stringify({ fields: campos }),
    })
  }
  return campos.CadastrosVersao
}

/* -------------------------------- histórico -------------------------------- */

async function excluirExecucao(execucaoId) {
  const listaId = await idDaLista(LIST_EXECUCOES)
  const siteId = await idDoSite()
  const r = await graph(
    `/sites/${siteId}/lists/${listaId}/items?$filter=${encodeURIComponent(
      `fields/ExecucaoId eq '${String(execucaoId).replace(/'/g, "''")}'`,
    )}&$top=1`,
  )
  const item = r.value?.[0]
  if (!item) return false
  await graph(`/sites/${siteId}/lists/${listaId}/items/${item.id}`, { method: 'DELETE' })
  return true
}

/* --------------------------------- servidor -------------------------------- */

const ORIGENS = '*'

function json(res, status, dados) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGENS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(dados))
}

/** Freio simples contra tentativa de senha em massa, por IP. */
const tentativas = new Map()
const JANELA_MS = 10 * 60 * 1000
const MAX_TENTATIVAS = 10

function bloqueado(ip) {
  const reg = tentativas.get(ip)
  if (!reg) return false
  if (Date.now() - reg.desde > JANELA_MS) {
    tentativas.delete(ip)
    return false
  }
  return reg.contagem >= MAX_TENTATIVAS
}

function registrarFalha(ip) {
  const reg = tentativas.get(ip)
  if (!reg || Date.now() - reg.desde > JANELA_MS) {
    tentativas.set(ip, { desde: Date.now(), contagem: 1 })
  } else {
    reg.contagem++
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const ip = req.socket.remoteAddress ?? 'desconhecido'

  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (!url.pathname.startsWith('/admin/')) return json(res, 404, { erro: 'rota inexistente' })

  if (bloqueado(ip)) return json(res, 429, { erro: 'muitas tentativas; aguarde 10 minutos' })

  const auth = req.headers.authorization ?? ''
  const senha = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!senhaConfere(senha)) {
    registrarFalha(ip)
    return json(res, 401, { erro: 'senha de administrador inválida' })
  }

  try {
    if (req.method === 'GET' && url.pathname === '/admin/estado') {
      const cfg = await lerConfig()
      return json(res, 200, {
        admin: true,
        versao: cfg.versao,
        pessoas: cfg.pessoas.length,
        equipamentos: cfg.equipamentos.length,
      })
    }

    if (req.method === 'POST' && url.pathname === '/admin/pessoas') {
      const corpo = await lerCorpo(req)
      if (!Array.isArray(corpo.pessoas)) return json(res, 400, { erro: 'envie { pessoas: [] }' })
      const atual = await lerConfig()
      const versao = await gravarConfig(atual, { pessoas: corpo.pessoas })
      console.log(`pessoas: ${corpo.pessoas.length} (versão ${versao})`)
      return json(res, 200, { ok: true, versao })
    }

    if (req.method === 'POST' && url.pathname === '/admin/equipamentos') {
      const corpo = await lerCorpo(req)
      if (!Array.isArray(corpo.equipamentos)) {
        return json(res, 400, { erro: 'envie { equipamentos: [] }' })
      }
      const atual = await lerConfig()
      const versao = await gravarConfig(atual, { equipamentos: corpo.equipamentos })
      console.log(`equipamentos: ${corpo.equipamentos.length} (versão ${versao})`)
      return json(res, 200, { ok: true, versao })
    }

    const m = url.pathname.match(/^\/admin\/execucoes\/([^/]+)\/excluir$/)
    if (req.method === 'POST' && m) {
      const apagou = await excluirExecucao(decodeURIComponent(m[1]))
      console.log(`exclusão ${m[1]}: ${apagou ? 'apagada' : 'não encontrada'}`)
      return json(res, apagou ? 200 : 404, { ok: apagou })
    }

    return json(res, 404, { erro: 'rota inexistente' })
  } catch (e) {
    console.error(e.message)
    return json(res, 500, { erro: e.message })
  }
})

async function lerCorpo(req) {
  const partes = []
  for await (const parte of req) partes.push(parte)
  const texto = Buffer.concat(partes).toString('utf8')
  return texto ? JSON.parse(texto) : {}
}

servidor.listen(Number(ADMIN_PORT), '0.0.0.0', () => {
  console.log(`fichas-admin ouvindo em 0.0.0.0:${ADMIN_PORT}`)
})
