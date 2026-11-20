/**
 * Conta no Supabase: login por e-mail e senha.
 *
 * Por que existe este módulo: o app fala direto com o Supabase Auth para o que
 * é do próprio usuário (entrar, sair, trocar a própria senha). Nada aqui passa
 * pelo servidor de sync — trocar a própria senha é direito de quem está logado,
 * não uma operação de administrador.
 *
 * A `anon` key fica no bundle. Isso é esperado: ela não dá acesso a nada por si
 * só, e toda leitura de dados é barrada pela RLS, que exige um JWT de usuário
 * ativo. Quem protege os dados é a política no banco, não o segredo da chave.
 */

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const CHAVE_TOKEN = 'fichas:token'
const CHAVE_REFRESH = 'fichas:refresh'

export function supabaseConfigurado(): boolean {
  return Boolean(URL_BASE && ANON)
}

export function lerToken(): string | null {
  try {
    return localStorage.getItem(CHAVE_TOKEN)
  } catch {
    return null
  }
}

export function guardarSessaoAuth(accessToken: string, refreshToken?: string) {
  try {
    localStorage.setItem(CHAVE_TOKEN, accessToken)
    if (refreshToken) localStorage.setItem(CHAVE_REFRESH, refreshToken)
  } catch {
    /* localStorage indisponível */
  }
}

export function limparSessaoAuth() {
  try {
    localStorage.removeItem(CHAVE_TOKEN)
    localStorage.removeItem(CHAVE_REFRESH)
  } catch {
    /* localStorage indisponível */
  }
}

export interface ResultadoAuth {
  ok: boolean
  erro?: string
}

/** Traduz as mensagens do Supabase para algo que o técnico entende. */
function traduzirErro(mensagem: string): string {
  const m = mensagem.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado. Fale com o administrador.'
  if (m.includes('password should be at least')) return 'A senha é curta demais.'
  if (m.includes('same password')) return 'A nova senha precisa ser diferente da atual.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere um instante e tente de novo.'
  if (m.includes('user not found')) return 'Conta não encontrada.'
  if (m.includes('failed to fetch') || m.includes('networkerror')) return 'Sem conexão com o servidor.'
  return mensagem
}

/**
 * Chamada ao Supabase. `base` existe porque nem tudo mora no Supabase: criar
 * usuário passa pelo nosso servidor de sync, que guarda a chave de serviço.
 */
async function pedir(
  caminho: string,
  corpo: unknown,
  token?: string,
  base: string = URL_BASE,
  metodo: 'POST' | 'PUT' = 'POST',
): Promise<Response> {
  // `apikey` é do Supabase; o servidor de sync não a usa e o navegador
  // bloqueia cabeçalho não previsto no CORS — mandar só quando a chamada é
  // para o Supabase evita esse preflight desnecessário.
  const ehSupabase = base === URL_BASE
  return fetch(`${base}${caminho}`, {
    method: metodo,
    headers: {
      ...(ehSupabase ? { apikey: ANON } : {}),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo),
  })
}

/**
 * Endereço do servidor de sync, que é quem tem a chave de serviço. Mesma chave
 * que o resto do app usa (`fichas:syncUrl`) — em branco, o convite falha com
 * mensagem clara em vez de tentar um host inexistente.
 */
export function baseSync(): string {
  try {
    const salvo = (localStorage.getItem('fichas:syncUrl') ?? '').trim().replace(/\/$/, '')
    if (salvo) return salvo
  } catch {
    /* localStorage indisponível */
  }
  // Endereço fixo do servidor, gravado no build. Com o app hospedado fora do
  // Pi, ninguém vai digitar o endereço do sync no celular de cada técnico — e
  // sem ele a chamada caía no próprio site e voltava 404.
  return (import.meta.env.VITE_SYNC_URL as string | undefined)?.trim().replace(/\/$/, '') ?? ''
}

/**
 * Entra com e-mail e senha.
 *
 * O token só é guardado **depois** de confirmar que a conta tem perfil ativo.
 * Antes, quem digitava a senha de uma conta sem perfil (ou inativa) recebia o
 * erro na tela, mas o token ficava salvo no aparelho — e a próxima chamada
 * saía com a identidade errada, caindo na conta de outra pessoa que já estava
 * logada ali.
 */
export async function entrarComSenha(
  email: string,
  senha: string,
): Promise<ResultadoAuth & { nome?: string; id?: string; perfil?: PerfilLido }> {
  if (!supabaseConfigurado()) return { ok: false, erro: 'Servidor não configurado neste aparelho.' }
  try {
    const r = await pedir('/auth/v1/token?grant_type=password', { email, password: senha })
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      return { ok: false, erro: traduzirErro(dados.error_description ?? dados.msg ?? `HTTP ${r.status}`) }
    }

    // Confere o perfil com este token, antes de gravar qualquer coisa. Se a
    // conta não faz parte do time, a sessão anterior continua intacta e o
    // aparelho não fica com um token órfão.
    const perfil = await perfilDoToken(dados.access_token)
    if (!perfil.ok) return { ok: false, erro: perfil.erro }

    guardarSessaoAuth(dados.access_token, dados.refresh_token)
    return { ok: true, nome: dados.user?.email, id: dados.user?.id, perfil: perfil.perfil }
  } catch (e) {
    return { ok: false, erro: traduzirErro((e as Error).message) }
  }
}

/**
 * Troca a senha de quem está logado.
 *
 * O Supabase exige o token do próprio usuário nesta rota — não dá para trocar a
 * senha de outra pessoa por aqui, nem com a chave de serviço. É exatamente o
 * que queremos: cada um cuida da sua.
 *
 * Depois da troca, os outros aparelhos continuam com a sessão antiga até o
 * token vencer; este aparelho segue logado. Não deslogamos ninguém de
 * propósito: derrubar a sessão no meio de uma ficha em campo seria pior.
 */
export async function trocarSenha(senhaAtual: string, senhaNova: string): Promise<ResultadoAuth> {
  if (!supabaseConfigurado()) return { ok: false, erro: 'Servidor não configurado neste aparelho.' }
  const token = lerToken()
  if (!token) return { ok: false, erro: 'Sessão expirada. Entre novamente.' }
  // Trocar a própria senha fala direto com o Supabase; não passa pelo servidor
  // de sync, que só existe para o que exige a chave de serviço.
  if (senhaNova.length < 6) return { ok: false, erro: 'A nova senha precisa ter ao menos 6 caracteres.' }
  if (senhaAtual === senhaNova) return { ok: false, erro: 'A nova senha precisa ser diferente da atual.' }

  try {
    // Atualizar o próprio usuário é PUT em /auth/v1/user; POST devolve 405.
    const r = await pedir('/auth/v1/user', { password: senhaNova }, token, URL_BASE, 'PUT')
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      return { ok: false, erro: traduzirErro(dados.error_description ?? dados.msg ?? dados.message ?? `HTTP ${r.status}`) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: traduzirErro((e as Error).message) }
  }
}

/** Sai: apaga o token deste aparelho. */
export async function sairConta(): Promise<void> {
  const token = lerToken()
  limparSessaoAuth()
  if (!token || !supabaseConfigurado()) return
  try {
    await pedir('/auth/v1/logout', {}, token)
  } catch {
    /* sem rede: o token local já foi apagado, o remoto vence sozinho */
  }
}

/**
 * Convida um técnico por e-mail.
 *
 * O caminho é `/auth/v1/invite`: o Supabase cria a conta e manda um e-mail com
 * link para a própria pessoa definir a senha. Isso é o oposto de "admin digita
 * a senha do técnico" — o administrador nunca sabe a senha de ninguém, e o
 * técnico recebe o convite na caixa dele.
 *
 * Só administrador pode chamar. A checagem é no servidor de sync (ele guarda a
 * chave de serviço); o app só repassa o pedido com o próprio token.
 */
/**
 * Envia o convite já com o cadastro completo.
 *
 * O convite **é** o cadastro: nome, RG, função e nível viajam no metadata do
 * usuário e o perfil nasce quando a pessoa abre o link e define a senha. Antes
 * o administrador tinha de salvar o perfil por fora, e quem aceitava o convite
 * caía no limbo "sem perfil".
 */
export async function convidarTecnico(
  email: string,
  cadastro: { nome: string; rg?: string; funcao?: string; nivel?: string; ativo?: boolean },
): Promise<ResultadoAuth> {
  const nome = cadastro.nome
  const limpo = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo)) return { ok: false, erro: 'E-mail inválido.' }
  if (!supabaseConfigurado()) return { ok: false, erro: 'Servidor não configurado neste aparelho.' }

  const token = lerToken()
  if (!token) return { ok: false, erro: 'Sessão expirada. Entre novamente.' }

  const base = baseSync()
  if (!base) {
    return {
      ok: false,
      erro: 'Servidor de convites não configurado. Fale com o administrador do sistema.',
    }
  }

  try {
    const r = await pedir(
      '/admin/convite',
      {
        email: limpo,
        nome,
        rg: cadastro.rg,
        funcao: cadastro.funcao,
        nivel: cadastro.nivel,
        ativo: cadastro.ativo,
      },
      token,
      base,
    )
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = String(dados.msg ?? dados.message ?? dados.error_description ?? `HTTP ${r.status}`)
      if (msg.toLowerCase().includes('already')) {
        return { ok: false, erro: 'Este e-mail já tem conta. Use "reenviar convite".' }
      }
      if (r.status === 404) {
        return {
          ok: false,
          erro: 'O servidor de convites está fora do ar. Avise o administrador do sistema.',
        }
      }
      if (r.status === 401 || r.status === 403) {
        return { ok: false, erro: 'Sua sessão não permite convidar. Entre novamente.' }
      }
      return { ok: false, erro: traduzirErro(msg) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: traduzirErro((e as Error).message) }
  }
}

/** Reenvia o e-mail de definição de senha para quem já tem conta. */
export async function reenviarConvite(email: string): Promise<ResultadoAuth> {
  if (!supabaseConfigurado()) return { ok: false, erro: 'Servidor não configurado neste aparelho.' }
  try {
    const r = await fetch(`${URL_BASE}/auth/v1/recover`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    if (!r.ok) {
      const dados = await r.json().catch(() => ({}))
      return { ok: false, erro: traduzirErro(String(dados.msg ?? `HTTP ${r.status}`)) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: traduzirErro((e as Error).message) }
  }
}

/**
 * Perfil de quem acabou de entrar.
 *
 * O Supabase Auth só sabe e-mail e id. Nome, RG e nível moram em `perfis`, e é
 * de lá que sai a sessão que o app usa nas telas. Lido com o token da própria
 * pessoa: a política de RLS deixa cada um ver o seu, e ninguém vê o dos outros.
 */
export interface PerfilLido {
  nome: string
  rg: string
  nivel: 'administrador' | 'usuario'
  ativo: boolean
}

export async function lerMeuPerfil(): Promise<{
  ok: boolean
  erro?: string
  perfil?: PerfilLido
}> {
  const token = lerToken()
  if (!token) return { ok: false, erro: 'Sessão expirada. Entre novamente.' }
  return perfilDoToken(token)
}

/**
 * Lê o perfil de um token específico, sem depender do que está guardado.
 *
 * Serve para validar o login antes de gravar a sessão: `lerMeuPerfil` sempre
 * usa o token salvo, o que seria a sessão antiga no momento do login.
 */
export async function perfilDoToken(token: string): Promise<{
  ok: boolean
  erro?: string
  perfil?: PerfilLido
}> {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/perfis?select=nome,rg,nivel,ativo&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return { ok: false, erro: traduzirErro(`HTTP ${r.status}`) }
    const linhas = await r.json()
    const p = Array.isArray(linhas) ? linhas[0] : null
    if (!p) return { ok: false, erro: 'Este e-mail não tem perfil no sistema. Fale com o administrador.' }
    if (!p.ativo) return { ok: false, erro: 'Usuário inativo. Fale com o administrador.' }
    return { ok: true, perfil: p }
  } catch (e) {
    return { ok: false, erro: traduzirErro((e as Error).message) }
  }
}
