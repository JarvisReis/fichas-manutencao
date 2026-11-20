#!/usr/bin/env node
/**
 * Serviço de sincronização das fichas — Supabase.
 *
 * Antes: gravava em listas do SharePoint via Microsoft Graph. O SharePoint foi
 * aposentado em 2026-11-18; agora o destino é o Postgres do Supabase, e a
 * autenticação é por PESSOA (JWT do Supabase), não mais por token fixo
 * compartilhado.
 *
 * O que este processo faz e que o app NÃO pode fazer sozinho: conversar com o
 * Supabase usando a chave de serviço, para duas operações de confiança:
 *   1. concluir uma ficha já fechada (exige administrador);
 *   2. ler/gravar cadastros e apagar histórico (exige administrador).
 *
 * Todo o resto — enviar ficha nova, ler o núcleo de um contator — usa a chave
 * anônima direto do app, sob RLS, e nem passa por aqui. O servidor existe para
 * o que a RLS não deixa o cliente decidir sozinho.
 *
 * Por que não expor a service_role no app: ela ignora TODAS as políticas. Um
 * celular perdido com a chave no localStorage daria acesso total ao banco.
 *
 * Variáveis de ambiente (arquivo /etc/fichas-sync.env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY       usada para validar o JWT de quem chama
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PORT                    padrão 8787
 *
 * Autorização: cada requisição manda `Authorization: Bearer <access_token>` do
 * Supabase. O servidor pergunta ao próprio Supabase de quem é o token e checa
 * o nível em `perfis`. Token de terceiro, token vencido e usuário inativo são
 * recusados com 401.
 */
import http from 'node:http'

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PORT = '8787' } = process.env

const faltando = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
  (k) => !process.env[k],
)
if (faltando.length) {
  console.error(`Faltam variáveis de ambiente: ${faltando.join(', ')}`)
  process.exit(1)
}

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`

/** Cabeçalhos de serviço: ignoram RLS. Só aqui dentro, nunca no cliente. */
function cabecalhosServico() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Chama o PostgREST com a chave de serviço. */
async function servico(caminho, opcoes = {}) {
  const r = await fetch(`${REST}${caminho}`, {
    ...opcoes,
    headers: { ...cabecalhosServico(), ...(opcoes.headers ?? {}) },
  })
  const texto = await r.text()
  if (!r.ok) throw new ErroHttp(r.status, texto || `HTTP ${r.status}`)
  return texto ? JSON.parse(texto) : null
}

class ErroHttp extends Error {
  constructor(status, corpo) {
    super(corpo)
    this.status = status
  }
}

/**
 * Quem está chamando.
 *
 * Delegamos a validação ao endpoint `/auth/v1/user` do Supabase: ele confere
 * assinatura e validade do JWT. Não fazemos verificação de assinatura aqui de
 * propósito — reimplementar isso é como errar a comparação em tempo constante.
 * Depois lemos `perfis` para o nível e o `ativo`.
 */
async function quemChama(req) {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new ErroHttp(401, 'sem token')

  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new ErroHttp(401, 'token inválido ou vencido')
  const usuario = await r.json()
  if (!usuario?.id) throw new ErroHttp(401, 'token inválido')

  const perfil = await servico(
    `/perfis?user_id=eq.${encodeURIComponent(usuario.id)}&select=nome,rg,nivel,ativo`,
  )
  const p = perfil?.[0]
  if (!p) throw new ErroHttp(403, 'usuário sem perfil no sistema')
  if (!p.ativo) throw new ErroHttp(403, 'usuário inativo')

  return { id: usuario.id, email: usuario.email ?? '', ...p }
}

async function exigirAdministrador(req) {
  const quem = await quemChama(req)
  if (quem.nivel !== 'administrador') throw new ErroHttp(403, 'exige administrador')
  return quem
}

/**
 * Igual a `quemChama`, mas para quem ainda não tem perfil — o caso do convidado
 * que acabou de definir a senha. Devolve o usuário do Auth cru (id, e-mail e
 * metadata), sem exigir linha em `perfis`.
 */
async function usuarioDoToken(req) {
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new ErroHttp(401, 'sem token')

  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  const usuario = await r.json().catch(() => ({}))
  if (!r.ok || !usuario?.id) throw new ErroHttp(401, 'token inválido ou vencido')
  return usuario
}

/* ------------------------------- operações -------------------------------- */

/**
 * Execuções que o aparelho pode guardar, no formato que o app usa (camelCase).
 *
 * Administrador vê o serviço inteiro; técnico vê as fichas que ele mesmo criou.
 * Rascunho não desce: rascunho é trabalho em andamento no aparelho de quem
 * começou — baixar rascunho de outro aparelho criaria ficha duplicada na home.
 */
async function baixarHistorico(quem, { desde, limite }) {
  const filtros = [
    'select=*',
    'status=in.(concluida,pendente)',
    `order=atualizada_em.desc`,
    `limit=${limite}`,
  ]
  if (quem.nivel !== 'administrador') {
    filtros.push(`criada_por=eq.${encodeURIComponent(quem.id)}`)
  }
  if (desde) filtros.push(`atualizada_em=gt.${encodeURIComponent(desde)}`)

  const linhas = await servico(`/execucoes?${filtros.join('&')}`)

  const execucoes = (linhas ?? []).map((l) => ({
    id: l.client_id,
    codigo: l.codigo,
    fichaId: l.ficha_id,
    marca: l.marca ?? undefined,
    tipoManutencao: l.tipo_manutencao ?? undefined,
    cabecalho: {},
    camposFixos: {
      equipamento: l.equipamento ?? '',
      ...(l.rg1 ? { rg1: l.rg1 } : {}),
      ...(l.rg2 ? { rg2: l.rg2 } : {}),
      ...(l.serie_retirado ? { serieRetirado: l.serie_retirado } : {}),
    },
    nucleoInstalado: l.nucleo_instalado ?? undefined,
    local: l.local ?? '',
    dataHora: l.data_hora,
    dataFim: l.data_fim ?? undefined,
    valores: l.valores ?? [],
    observacaoGeral: l.observacao_geral ?? undefined,
    status: l.status,
    criadaPor: l.criada_por ?? undefined,
    sincronizada: true,
    criadaEm: l.criada_em ?? l.data_hora,
    atualizadaEm: l.atualizada_em ?? l.data_hora,
  }))

  /**
   * Equipamentos vão junto.
   *
   * Sem eles a home de um aparelho novo mostrava "nenhum equipamento
   * cadastrado" mesmo com o histórico baixado — a lista de equipamentos nunca
   * descia do servidor, só existia no aparelho onde foi digitada.
   */
  const equipamentosBrutos = await servico('/equipamentos?select=*&order=nome.asc').catch(
    () => [],
  )
  const equipamentos = (equipamentosBrutos ?? []).map((e) => ({
    id: e.id,
    nome: e.nome,
    fichaId: e.ficha_id,
    local: e.local ?? '',
    marca: e.marca ?? undefined,
    serie: e.serie ?? undefined,
    observacao: e.observacao ?? undefined,
    ativo: e.ativo !== false,
  }))

  return { ok: true, execucoes, equipamentos, total: execucoes.length }
}

/** Núcleo instalado atual de um contator — leitura que qualquer técnico ativo faz. */
async function nucleoDoEquipamento(nome) {
  const linhas = await servico(
    `/equipamentos?nome=eq.${encodeURIComponent(nome)}&select=nucleo_instalado`,
  )
  return { nucleoInstalado: linhas?.[0]?.nucleo_instalado ?? null }
}

/**
 * Grava uma execução nova.
 *
 * Idempotência por `client_id`: o celular pode reenviar quantas vezes quiser.
 * `on_conflict` + `resolution=merge-duplicates` transforma o reenvio em
 * atualização das mesmas colunas, sem duplicar linha.
 *
 * Autoria: `criada_por` é SEMPRE o dono do token, nunca um campo do payload.
 * Mandar `criada_por` no corpo não tem efeito — o campo é sobrescrito aqui.
 */
async function gravarExecucao(quem, p) {
  if (!p?.client_id) throw new ErroHttp(400, 'execução sem client_id')
  if (!p?.codigo) throw new ErroHttp(400, 'execução sem código')

  const existentes = await servico(
    `/execucoes?client_id=eq.${encodeURIComponent(p.client_id)}&select=id,status,criada_por`,
  )
  const existente = existentes?.[0]

  if (existente) {
    const fechada = existente.status === 'concluida' || existente.status === 'pendente'
    const deOutro = existente.criada_por !== quem.id
    if (fechada && quem.nivel !== 'administrador') {
      return { criado: false, recusado: 'fechada' }
    }
    if (deOutro && quem.nivel !== 'administrador') {
      return { criado: false, recusado: 'autoria' }
    }
  }

  /**
   * O app envia em camelCase (`fichaId`, `tipoManutencao`…); o banco usa
   * snake_case. Antes o servidor lia só snake_case, então `ficha_id` chegava
   * null e o Postgres recusava a linha inteira — nenhuma ficha jamais subiu.
   * Cada campo aceita as duas formas.
   */
  const linha = {
    client_id: p.client_id ?? p.id,
    codigo: p.codigo,
    ficha_id: p.ficha_id ?? p.fichaId,
    equipamento_id: p.equipamento_id || p.equipamentoId || null,
    equipamento: p.equipamento ?? '',
    local: p.local ?? '',
    marca: p.marca ?? null,
    tipo_manutencao: p.tipo_manutencao ?? p.tipoManutencao ?? null,
    nucleo_instalado: p.nucleo_instalado ?? p.nucleoInstalado ?? null,
    nucleo_retirado: p.nucleo_retirado ?? p.nucleoRetirado ?? null,
    data_hora: p.data_hora ?? p.dataHora,
    data_fim: p.data_fim ?? p.dataFim ?? null,
    valores: p.valores ?? [],
    observacao_geral: p.observacao_geral ?? p.observacaoGeral ?? null,
    nao_conformes: p.nao_conformes ?? p.naoConformes ?? 0,
    status: p.status ?? 'rascunho',
    /**
     * A equipe vem de `cabecalho`, não do topo do payload.
     *
     * O app sempre mandou os RGs dentro de `cabecalho` (rg1…rg6); o servidor só
     * lia `p.rg1`. Resultado: toda ficha subia com equipe nula, e o outro
     * aparelho recebia a execução sem saber quem a fez. Aceitar as duas formas
     * conserta também as fichas já gravadas, na próxima vez que subirem.
     */
    rg1: p.rg1 ?? p.cabecalho?.rg1 ?? null,
    rg2: p.rg2 ?? p.cabecalho?.rg2 ?? null,
    criada_por: quem.id,
    atualizada_em: new Date().toISOString(),
  }

  await servico('/execucoes?on_conflict=client_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linha),
  })

  // P2: o núcleo que entrou no contator passa a ser o instalado do equipamento.
  if (linha.tipo_manutencao === 'P2' && linha.nucleo_instalado && linha.equipamento_id) {
    await servico(`/equipamentos?id=eq.${encodeURIComponent(linha.equipamento_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ nucleo_instalado: linha.nucleo_instalado }),
    }).catch((e) => console.warn(`núcleo não atualizado: ${e.message}`))
  }

  return { criado: !existente, atualizado: Boolean(existente) }
}

async function excluirExecucao(id) {
  await servico(`/execucoes?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })
  return { ok: true }
}

/** Cadastros: substitui o conjunto inteiro (é o que o app já exporta). */
/**
 * Grava a equipe em `perfis`.
 *
 * `perfis.user_id` é chave estrangeira para `auth.users`: só entra quem tem
 * conta no Supabase. Isso é proposital — o perfil é a ficha de acesso, não um
 * cadastro solto. Um funcionário digitado no app e ainda sem convite aceito
 * NÃO pode ser gravado aqui (o banco recusa, e está certo).
 *
 * Por isso devolvemos quem ficou de fora em vez de falhar em silêncio: o app
 * mostra "fulano ainda não tem acesso" e o administrador manda o convite.
 */
async function gravarPessoas(pessoas) {
  if (!Array.isArray(pessoas)) throw new ErroHttp(400, 'pessoas deve ser lista')

  const recebidas = pessoas.filter((p) => p && String(p.rg ?? '').trim())
  const semConta = []
  const linhas = []

  for (const p of recebidas) {
    /**
     * Sem `userId` a pessoa não tem conta no Supabase — mas continua sendo
     * funcionário e continua entrando na dupla das fichas. Antes ela era
     * descartada aqui ("semConta") e sumia no outro aparelho, porque a tabela
     * `perfis` exige `user_id` de `auth.users`. Agora vai para `pessoas`.
     */
    if (!p.userId) {
      semConta.push({
        id: String(p.id ?? '').trim() || `p-${String(p.rg).trim().toUpperCase()}`,
        nome: String(p.nome ?? '').trim(),
        rg: String(p.rg ?? '').trim().toUpperCase(),
        funcao: p.funcao ?? null,
        email: p.email ?? null,
        nivel: p.nivel === 'administrador' ? 'administrador' : 'usuario',
        ativo: p.ativo !== false,
      })
      continue
    }
    linhas.push({
      user_id: p.userId,
      nome: String(p.nome ?? '').trim(),
      rg: String(p.rg ?? '').trim().toUpperCase(),
      funcao: p.funcao ?? null,
      // o banco só conhece 'administrador' e 'usuario'
      nivel: p.nivel === 'administrador' ? 'administrador' : 'usuario',
      ativo: p.ativo !== false,
    })
  }

  if (linhas.length > 0) {
    await servico('/perfis?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(linhas),
    })
  }

  if (semConta.length > 0) {
    await servico('/pessoas?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(semConta.map((p) => ({ ...p, atualizado_em: new Date().toISOString() }))),
    })
  }

  return { ok: true, recebidas: linhas.length + semConta.length, semConta: semConta.length }
}

async function gravarEquipamentos(equipamentos) {
  if (!Array.isArray(equipamentos)) throw new ErroHttp(400, 'equipamentos deve ser lista')

  // Um contator tem UM cadastro. A gravação é por `id`, então um aparelho com
  // o mesmo nome e id diferente (aconteceu com o CLI-CT01) criava uma segunda
  // linha em vez de corrigir a existente. Aqui a lista é reduzida por nome,
  // mantendo a última ocorrência — que é a versão que o administrador acabou
  // de salvar na tela.
  const porNome = new Map()
  for (const e of equipamentos) {
    const chave = String(e.nome ?? '').trim().toLowerCase()
    if (!chave) continue
    porNome.set(chave, e)
  }
  const unicos = equipamentos.filter((e) => {
    const chave = String(e.nome ?? '').trim().toLowerCase()
    return !chave || porNome.get(chave) === e
  })

  const linhas = unicos.map((e) => ({
    id: e.id,
    nome: e.nome,
    ficha_id: e.fichaId ?? e.ficha_id,
    local: e.local ?? '',
    marca: e.marca ?? null,
    serie: e.serie ?? null,
    observacao: e.observacao ?? null,
    ativo: e.ativo !== false,
    atualizado_em: new Date().toISOString(),
  }))

  await servico('/equipamentos?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  })

  // Gravar por `id` não limpa a linha gêmea que já estava no banco com outro
  // id: a lista do aparelho manda só um CLI-CT01, mas o registro antigo
  // (`eq-cli-ct01`) continuava lá e voltava em todo download. Quem manda é a
  // lista publicada — o que não está nela, com o mesmo nome, sai.
  const nomes = linhas.map((l) => l.nome).filter(Boolean)
  const idsMantidos = linhas.map((l) => l.id)
  if (nomes.length > 0) {
    const existentes = await servico(
      `/equipamentos?select=id,nome&nome=in.(${nomes.map((n) => `"${String(n).replace(/"/g, '')}"`).join(',')})`,
      { method: 'GET' },
    )
    const sobrando = (existentes ?? []).filter((r) => !idsMantidos.includes(r.id))
    for (const r of sobrando) {
      await servico(`/equipamentos?id=eq.${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    }
    if (sobrando.length > 0) {
      console.log(`equipamentos duplicados removidos: ${sobrando.map((r) => r.id).join(', ')}`)
    }
  }

  return { ok: true, gravados: linhas.length }
}

/* ---------------------------------- HTTP ---------------------------------- */

/** Chave única em `configuracoes` para os ajustes das fichas. */
const CHAVE_AJUSTES = 'fichas-ajustes'

/** Lê os ajustes publicados. Qualquer usuário autenticado recebe. */
async function lerAjustesDeFichas() {
  const linhas = await servico(
    `/configuracoes?chave=eq.${CHAVE_AJUSTES}&select=valor,atualizado_em,atualizado_por`,
  )
  const linha = linhas?.[0]
  if (!linha) return { ajustes: {}, atualizadoEm: null, atualizadoPor: null }
  const ajustes = linha.valor && typeof linha.valor === 'object' ? linha.valor.ajustes : null
  return {
    ajustes: ajustes && typeof ajustes === 'object' && !Array.isArray(ajustes) ? ajustes : {},
    atualizadoEm: linha.atualizado_em ?? null,
    atualizadoPor: linha.atualizado_por ?? null,
  }
}

/**
 * Publica os ajustes. Só administrador — e o corpo é revalidado aqui, porque
 * quem chama a API pode não ser o app.
 */
async function gravarAjustesDeFichas(quem, dados) {
  const ajustes = dados?.ajustes
  if (!ajustes || typeof ajustes !== 'object' || Array.isArray(ajustes)) {
    throw new ErroHttp(400, 'envie { ajustes: { <idDaFicha>: { ... } } }')
  }
  const chaves = Object.keys(ajustes)
  if (chaves.length > 200) throw new ErroHttp(400, 'ajustes demais')
  for (const id of chaves) {
    const ajuste = ajustes[id]
    if (!ajuste || typeof ajuste !== 'object' || Array.isArray(ajuste)) {
      throw new ErroHttp(400, `ajuste inválido para a ficha ${id}`)
    }
    if (ajuste.itens !== undefined && !Array.isArray(ajuste.itens)) {
      throw new ErroHttp(400, `itens inválidos na ficha ${id}`)
    }
  }

  const agora = new Date().toISOString()
  await servico('/configuracoes?on_conflict=chave', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      { chave: CHAVE_AJUSTES, valor: { ajustes }, atualizado_em: agora, atualizado_por: quem.id },
    ]),
  })

  /**
   * Devolve o que foi gravado, não o que foi enviado.
   *
   * O aparelho do administrador guarda este `atualizadoEm` como marcador da
   * versão em vigor. Se o servidor arredondasse ou mudasse o carimbo, o próprio
   * autor baixaria a versão "nova" a cada abertura e reescreveria o IndexedDB
   * dele sem necessidade.
   */
  return { ok: true, atualizadoEm: agora, atualizadoPor: quem.id, autor: quem.nome ?? null }
}

function json(res, status, dados) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  })
  res.end(JSON.stringify(dados))
}

async function corpo(req) {
  const partes = []
  for await (const parte of req) partes.push(parte)
  if (!partes.length) return {}
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'))
  } catch {
    throw new ErroHttp(400, 'JSON inválido')
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') return json(res, 204, {})

  try {
    if (req.method === 'GET' && url.pathname === '/saude') {
      return json(res, 200, { ok: true, supabase: SUPABASE_URL })
    }

    if (req.method === 'GET' && url.pathname === '/fichas') {
      await quemChama(req)
      const equipamento = url.searchParams.get('equipamento')?.trim()
      if (!equipamento) return json(res, 400, { erro: 'informe ?equipamento=' })
      return json(res, 200, await nucleoDoEquipamento(equipamento))
    }

    /**
     * Histórico para o aparelho.
     *
     * Até aqui a sincronização só subia: o celular que preencheu a ficha tinha
     * tudo, e qualquer outro aparelho (o computador do escritório, o celular do
     * colega) abria a home vazia — sem recentes e sem histórico. Esta rota
     * devolve as execuções para o app reconstruir a lista local.
     *
     * `desde` permite trazer só o que mudou (sincronização incremental).
     */
    if (req.method === 'GET' && url.pathname === '/historico') {
      const quem = await quemChama(req)
      const desde = url.searchParams.get('desde')
      const limite = Math.min(Number(url.searchParams.get('limite')) || 500, 1000)
      return json(res, 200, await baixarHistorico(quem, { desde, limite }))
    }

    /**
     * Backups automáticos e cópia de recuperação.
     *
     * O dado mora no IndexedDB de cada aparelho, e "limpar cache" apaga tudo.
     * Foi assim que uma ficha de homologação inteira se perdeu: nunca subiu,
     * vivia só no navegador, e o técnico limpou o cache.
     *
     * Aqui o pacote inteiro (execuções, cadastros, equipe) vai para o servidor
     * em `jsonb`. Não é sincronização — é cópia de segurança: não volta
     * sozinho para a home e não interfere na fila de envio.
     */
    if (req.method === 'POST' && url.pathname === '/backups') {
      const quem = await quemChama(req)
      const p = await corpo(req)
      if (!p?.conteudo || typeof p.conteudo !== 'object') {
        return json(res, 400, { erro: 'backup sem conteúdo' })
      }
      const execucoes = Array.isArray(p.conteudo.execucoes) ? p.conteudo.execucoes.length : 0
      const equipamentos = Array.isArray(p.conteudo.cadastros?.equipamentos)
        ? p.conteudo.cadastros.equipamentos.length
        : 0
      const pessoas = Array.isArray(p.conteudo.cadastros?.pessoas)
        ? p.conteudo.cadastros.pessoas.length
        : 0

      // Aparelho sem nada dentro não é backup: protegeria zero fichas e ainda
      // empurraria os bons para fora da janela de retenção.
      if (execucoes === 0 && equipamentos === 0) {
        return json(res, 200, { ok: true, ignorado: 'backup vazio' })
      }

      await servico('/backups', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([
          {
            origem: p.origem === 'manual' ? 'manual' : 'auto',
            aparelho: p.aparelho ?? null,
            criado_por: quem.id,
            execucoes,
            equipamentos,
            pessoas,
            conteudo: p.conteudo,
          },
        ]),
      })

      // Retenção: os 60 mais recentes. Cada backup é pequeno, mas guardar tudo
      // para sempre enche a tabela e não serve para nada — o valor está nas
      // últimas semanas, não no histórico de um ano atrás.
      await servico('/backups?select=id&order=criado_em.desc&offset=60', { method: 'GET' })
        .then(async (velhos) => {
          for (const v of velhos ?? []) {
            await servico(`/backups?id=eq.${v.id}`, { method: 'DELETE' }).catch(() => {})
          }
        })
        .catch(() => {})

      return json(res, 201, { ok: true, execucoes, equipamentos, pessoas })
    }

    if (req.method === 'GET' && url.pathname === '/backups') {
      const quem = await quemChama(req)
      if (quem.nivel !== 'administrador') {
        return json(res, 403, { erro: 'só o administrador vê os backups' })
      }
      const lista = await servico(
        '/backups?select=id,criado_em,origem,aparelho,execucoes,equipamentos,pessoas&order=criado_em.desc&limit=30',
        { method: 'GET' },
      )
      return json(res, 200, { backups: lista ?? [] })
    }

    if (req.method === 'GET' && url.pathname.startsWith('/backups/')) {
      const quem = await quemChama(req)
      if (quem.nivel !== 'administrador') {
        return json(res, 403, { erro: 'só o administrador baixa backups' })
      }
      const id = decodeURIComponent(url.pathname.slice('/backups/'.length))
      if (!/^\d+$/.test(id)) return json(res, 400, { erro: 'id inválido' })
      const linhas = await servico(`/backups?id=eq.${id}&select=*`, { method: 'GET' })
      const linha = linhas?.[0]
      if (!linha) return json(res, 404, { erro: 'backup não encontrado' })
      return json(res, 200, { conteudo: linha.conteudo, criadoEm: linha.criado_em })
    }

    if (req.method === 'POST' && url.pathname === '/fichas') {
      const quem = await quemChama(req)
      const p = await corpo(req)
      if (p.formato !== 'fichas-execucao') {
        return json(res, 400, { erro: 'formato não reconhecido' })
      }
      const r = await gravarExecucao(quem, p)
      if (r.recusado === 'fechada') {
        console.log(`recusada ${p.codigo}: ficha fechada`)
        return json(res, 409, {
          ok: false,
          erro: 'ficha já concluída; correção exige administrador',
        })
      }
      if (r.recusado === 'autoria') {
        return json(res, 403, { ok: false, erro: 'ficha pertence a outro técnico' })
      }
      console.log(
        `${r.criado ? 'gravada' : 'atualizada'} ${p.codigo} (${p.client_id}) por ${quem.nome}`,
      )
      return json(res, r.criado ? 201 : 200, { ok: true, ...r })
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/fichas/')) {
      await exigirAdministrador(req)
      const id = decodeURIComponent(url.pathname.slice('/fichas/'.length))
      if (!id) return json(res, 400, { erro: 'id ausente' })
      return json(res, 200, await excluirExecucao(id))
    }

    /**
     * Convite de técnico.
     *
     * Fica no servidor porque criar usuário exige a service_role, e ela nunca
     * vai para o celular. Quem chama precisa ser administrador; o payload só
     * carrega e-mail e nome.
     *
     * O Supabase manda o e-mail com um link para a pessoa definir a própria
     * senha. Ninguém no time chega a conhecer a senha de outra pessoa.
     */
    /**
     * Ajustes das fichas — limites de medição, itens, nomes.
     *
     * A ficha em vigor é `padrão do código + ajuste`. O ajuste até aqui morava
     * só no IndexedDB de quem editava: o administrador revisava um limite e os
     * técnicos seguiam medindo pelo limite velho, sem nada indicando isso. Numa
     * ficha de conformidade essa é a pior divergência possível — o resultado
     * "conforme" de um aparelho não vale no outro.
     *
     * Agora o ajuste vive em `configuracoes` (chave 'fichas-ajustes'): desce
     * para todo aparelho autenticado e só o administrador escreve.
     */
    if (req.method === 'GET' && url.pathname === '/fichas-ajustes') {
      await quemChama(req)
      return json(res, 200, await lerAjustesDeFichas())
    }

    if (req.method === 'PUT' && url.pathname === '/fichas-ajustes') {
      const quem = await exigirAdministrador(req)
      return json(res, 200, await gravarAjustesDeFichas(quem, await corpo(req)))
    }

    if (req.method === 'POST' && url.pathname === '/admin/convite') {
      await exigirAdministrador(req)
      const { email, nome, rg, funcao, nivel, ativo } = await corpo(req)
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email))) {
        return json(res, 400, { erro: 'e-mail inválido' })
      }
      /**
       * O convite é o cadastro: nome e RG vão no metadata do usuário, porque é
       * o único lugar que sobrevive entre o envio do e-mail e o aceite. Quem
       * define a senha é o link; o perfil nasce quando o convite é aceito
       * (`/convite/aceitar`), sem o administrador precisar voltar no app.
       */
      const meta = {
        nome: String(nome ?? '').trim(),
        rg: String(rg ?? '').trim().toUpperCase(),
        funcao: String(funcao ?? '').trim(),
        nivel: nivel === 'administrador' ? 'administrador' : 'usuario',
        ativo: ativo !== false,
      }
      const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/invite`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: String(email).toLowerCase(), data: meta }),
      })
      const dados = await r.json().catch(() => ({}))
      if (!r.ok) {
        const msg = String(dados.msg ?? dados.message ?? `HTTP ${r.status}`)
        /**
         * O Supabase responde 422 para "usuário já existe" e também para
         * "endereço inválido", com o mesmo status. Separar pelo texto importa:
         * marcar domínio recusado como "já tem conta" mandaria o app oferecer
         * "reenviar convite" para um endereço que nunca vai receber nada.
         */
        if (/already|exists/i.test(msg)) return json(res, 409, { erro: 'já tem conta', detalhe: msg })
        if (/invalid|not valid/i.test(msg)) return json(res, 400, { erro: 'e-mail recusado pelo provedor', detalhe: msg })
        if (r.status >= 500) return json(res, 502, { erro: 'falha no convite', detalhe: msg })
        return json(res, 400, { erro: 'convite recusado', detalhe: msg })
      }
      return json(res, 200, { ok: true, user_id: dados.id ?? null })
    }

    /**
     * Equipe para montar dupla.
     *
     * Antes exigia administrador, e o técnico levava 403 — num aparelho novo
     * a lista de funcionários ficava vazia e não havia como escolher a dupla.
     * Agora qualquer usuário ativo com perfil lê; escrever continua sendo só
     * do administrador. Devolve apenas o que a ficha usa: nome, RG e função
     * — nada de e-mail ou identificador de conta.
     */
    if (req.method === 'GET' && url.pathname === '/equipe') {
      await quemChama(req)
      /**
       * Duas fontes, uma lista.
       *
       * `perfis` = quem tem conta no app (nasce no convite aceito).
       * `pessoas` = funcionário de campo sem conta (e-mail em branco).
       * Os dois entram na dupla da ficha; só os primeiros conseguem logar.
       *
       * O mesmo RG pode existir nos dois lugares quando alguém foi cadastrado
       * sem e-mail e depois recebeu convite. Nesse caso vale o perfil, que é o
       * cadastro vivo — o registro sem conta é descartado da resposta.
       */
      const [perfis, semConta] = await Promise.all([
        servico('/perfis?select=user_id,nome,rg,funcao,nivel,ativo&order=nome'),
        servico('/pessoas?select=id,nome,rg,funcao,email,nivel,ativo&order=nome'),
      ])

      const porRg = new Map()
      for (const p of perfis ?? []) {
        // perfil sem RG não é funcionário de campo: fica fora da equipe
        if (!String(p.rg ?? '').trim()) continue
        porRg.set(String(p.rg).trim().toUpperCase(), {
          id: p.user_id,
          userId: p.user_id,
          nome: p.nome,
          rg: p.rg,
          funcao: p.funcao ?? undefined,
          // 'usuario' no banco = técnico no app
          nivel: p.nivel === 'administrador' ? 'administrador' : 'usuario',
          ativo: p.ativo !== false,
        })
      }
      for (const p of semConta ?? []) {
        const rg = String(p.rg ?? '').trim()
        if (!rg) continue
        const chave = rg.toUpperCase()
        if (porRg.has(chave)) continue
        porRg.set(chave, {
          id: p.id,
          nome: p.nome,
          rg,
          funcao: p.funcao ?? undefined,
          email: p.email ?? undefined,
          nivel: p.nivel === 'administrador' ? 'administrador' : 'usuario',
          ativo: p.ativo !== false,
        })
      }

      const pessoas = [...porRg.values()].sort((a, b) =>
        String(a.nome).localeCompare(String(b.nome), 'pt-BR'),
      )
      return json(res, 200, { pessoas })
    }

    /**
     * Chamado pelo app depois que o convidado define a senha. O perfil nasce
     * aqui, não no cadastro do administrador: assim ninguém fica com conta no
     * Auth e sem perfil no banco, e o administrador não precisa voltar ao app
     * para "completar" o cadastro.
     *
     * A rota não é administrativa — quem chama é o próprio convidado, com o
     * token que acabou de receber. Os dados vêm do metadata do usuário
     * (gravado no convite) e o `user_id` vem do token, nunca do corpo.
     */
    if (req.method === 'POST' && url.pathname === '/convite/aceitar') {
      const quem = await usuarioDoToken(req)
      const meta = quem.user_metadata ?? {}
      const rg = String(meta.rg ?? '').trim().toUpperCase()
      if (!/^R\d{5,6}$/.test(rg)) {
        return json(res, 400, {
          erro: 'convite sem RG',
          detalhe: 'O administrador precisa convidar de novo informando o RG.',
        })
      }

      await servico('/perfis?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([
          {
            user_id: quem.id,
            nome: String(meta.nome ?? '').trim() || quem.email,
            rg,
            funcao: meta.funcao || null,
            nivel: meta.nivel === 'administrador' ? 'administrador' : 'usuario',
            ativo: meta.ativo !== false,
          },
        ]),
      })

      return json(res, 200, {
        ok: true,
        nome: String(meta.nome ?? '').trim() || quem.email,
        rg,
        nivel: meta.nivel === 'administrador' ? 'administrador' : 'usuario',
      })
    }

    if (req.method === 'POST' && url.pathname === '/admin/pessoas') {
      await exigirAdministrador(req)
      const p = await corpo(req)
      return json(res, 200, await gravarPessoas(p.pessoas))
    }

    /**
     * Equipamentos para qualquer usuário ativo.
     *
     * Antes a tabela `equipamentos` só tinha caminho de ida (POST /admin):
     * o administrador publicava e o outro aparelho nunca recebia. Num aparelho
     * novo a lista nascia vazia e a home dizia "nenhum equipamento cadastrado"
     * — o técnico não conseguia nem abrir ficha.
     */
    if (req.method === 'GET' && url.pathname === '/equipamentos') {
      await quemChama(req)
      const linhas = await servico(
        '/equipamentos?select=id,nome,ficha_id,local,marca,serie,observacao,nucleo_instalado,ativo&order=nome',
      )
      const equipamentos = (linhas ?? []).map((e) => ({
        id: e.id,
        nome: e.nome,
        fichaId: e.ficha_id,
        local: e.local ?? '',
        marca: e.marca ?? undefined,
        serie: e.serie ?? undefined,
        observacao: e.observacao ?? undefined,
        nucleoInstalado: e.nucleo_instalado ?? undefined,
        ativo: e.ativo !== false,
      }))
      return json(res, 200, { equipamentos })
    }

    if (req.method === 'POST' && url.pathname === '/admin/equipamentos') {
      await exigirAdministrador(req)
      const p = await corpo(req)
      return json(res, 200, await gravarEquipamentos(p.equipamentos))
    }

    return json(res, 404, { erro: 'rota inexistente' })
  } catch (e) {
    if (e instanceof ErroHttp) {
      if (e.status >= 500) console.error(e.message)
      return json(res, e.status, { erro: e.message })
    }
    console.error(e.message)
    return json(res, 500, { erro: e.message })
  }
})

servidor.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`fichas-sync ouvindo em 0.0.0.0:${PORT} -> ${SUPABASE_URL}`)
})
