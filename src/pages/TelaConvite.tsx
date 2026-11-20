import { useState } from 'react'
import { KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { baseSync, guardarSessaoAuth, lerMeuPerfil, limparSessaoAuth, supabaseConfigurado } from '../lib/auth'
import { gravarSessao } from '../lib/sessao'

/**
 * Aceite do convite.
 *
 * O Supabase manda a pessoa para cá com um token na URL
 * (`#access_token=...&type=invite`, ou `?token=...&type=invite` quando o link
 * ainda passa pelo `verify`). O app precisa trocar esse token por uma sessão e
 * pedir a senha — sem esta tela, o convite abria o app numa home vazia e a
 * pessoa ficava sem conseguir entrar nunca.
 */
/** Lê o `sub` (id do usuário) de um JWT sem validar assinatura — o token veio do Supabase. */
function lerIdDoToken(token: string): string | null {
  try {
    const carga = token.split('.')[1]
    if (!carga) return null
    const json = JSON.parse(atob(carga.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.sub === 'string' ? json.sub : null
  } catch {
    return null
  }
}

interface Props {
  onPronto: () => void
  /**
   * Chamado quando o convidado desiste e vai entrar com a própria senha.
   *
   * Não basta limpar a URL: o aparelho pode estar com a sessão de outra pessoa
   * (o admin, num celular de equipe), e o app abriria direto na conta dela. Aqui
   * a sessão salva é descartada e o app volta para o login.
   */
  onSairParaLogin: () => void
}

/** Lê o token do convite da URL, em qualquer um dos formatos que o Supabase usa. */
function lerConvite(): { token: string; refresh?: string } | null {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const params = new URLSearchParams(hash)
  const busca = new URLSearchParams(window.location.search)

  const acesso = params.get('access_token') ?? busca.get('access_token')
  if (acesso) {
    return { token: acesso, refresh: params.get('refresh_token') ?? busca.get('refresh_token') ?? undefined }
  }

  // formato do `action_link`: ?token=<hash>&type=invite
  const token = busca.get('token') ?? params.get('token')
  const tipo = busca.get('type') ?? params.get('type')
  if (token && tipo === 'invite') return { token }
  return null
}

/**
 * Motivo do link não servir, quando o próprio Supabase já disse qual foi.
 * `otp_expired` é o caso comum: o link vale uma vez só e o técnico clicou duas.
 */
function motivoDoErro(): string | null {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const params = new URLSearchParams(hash)
  const busca = new URLSearchParams(window.location.search)
  const codigo = params.get('error_code') ?? busca.get('error_code')
  if (!codigo && !params.get('error') && !busca.get('error')) return null
  if (codigo === 'otp_expired') {
    return 'Este link já foi usado ou venceu — ele só vale uma vez. Peça ao administrador para reenviar o convite.'
  }
  return 'Este link de convite não é válido ou já expirou. Peça um novo convite ao administrador.'
}

export function TelaConvite({ onPronto, onSairParaLogin }: Props) {
  const [convite] = useState<{ token: string; refresh?: string } | null>(() => lerConvite())
  const [senha, setSenha] = useState('')
  const [repetir, setRepetir] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(() =>
    lerConvite()
      ? null
      : (motivoDoErro() ??
        'Este link de convite não é válido ou já expirou. Peça um novo convite ao administrador.'),
  )
  const [ocupado, setOcupado] = useState(false)
  const [pronto, setPronto] = useState(false)

  const salvar = async () => {
    if (!convite) return
    setErro(null)

    if (senha.length < 6) {
      setErro('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (senha !== repetir) {
      setErro('As duas senhas não são iguais.')
      return
    }

    setOcupado(true)
    try {
      /**
       * Quem aceita o convite pode estar num aparelho já logado (o celular da
       * equipe). Sem apagar a sessão anterior, o app continuava entrando com
       * o usuário antigo — o convidado via a conta do administrador.
       */
      limparSessaoAuth()
      gravarSessao(null)

      // Com access_token já vindo na URL, a sessão está pronta: só é preciso
      // definir a senha. Com o token do `verify`, troca-se primeiro.
      let token = convite.token
      if (!convite.refresh) {
        const r = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(convite.token)}&type=invite`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } },
        )
        const dados = await r.json().catch(() => ({}))
        if (!r.ok || !dados.access_token) {
          setErro('Convite inválido ou expirado. Peça um novo ao administrador.')
          return
        }
        token = dados.access_token
        guardarSessaoAuth(token, dados.refresh_token)
      } else {
        guardarSessaoAuth(token, convite.refresh)
      }

      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: senha }),
      })
      if (!r.ok) {
        const dados = await r.json().catch(() => ({}))
        setErro(dados.message ?? 'Não foi possível salvar a senha. Tente de novo.')
        return
      }

      /**
       * O perfil nasce agora. O convite guardou nome/RG/nível no metadata do
       * usuário; o servidor lê dali e cria a linha em `perfis`. Assim o
       * administrador não precisa salvar o cadastro por fora — o convite é o
       * cadastro inteiro.
       */
      await fetch(`${baseSync()}/convite/aceitar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }).catch(() => null)

      const perfil = await lerMeuPerfil()
      if (!perfil.ok) {
        // Sem perfil não há como usar o app: encerra a sessão para não deixar
        // o aparelho logado como alguém que não consegue entrar.
        limparSessaoAuth()
        gravarSessao(null)
        setErro(
          perfil.erro ??
            'Sua senha foi salva, mas não consegui criar seu perfil. Fale com o administrador.',
        )
        return
      }

      // A sessão de trabalho passa a ser a do convidado, não a de quem estava
      // no aparelho antes. `pessoaId` é o id do usuário no Supabase, que é o
      // mesmo `perfis.user_id`.
      const idUsuario = lerIdDoToken(token)
      if (idUsuario) {
        gravarSessao({
          pessoaId: idUsuario,
          nome: perfil.perfil?.nome ?? '',
          rg: perfil.perfil?.rg ?? '',
          nivel: perfil.perfil?.nivel ?? 'usuario',
        })
      }

      // limpa o token da barra de endereços: ele não pode ficar no histórico
      window.history.replaceState(null, '', window.location.pathname)
      setPronto(true)
      setTimeout(onPronto, 1200)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  if (!supabaseConfigurado()) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-slate-600">
        Servidor não configurado neste aparelho.
      </div>
    )
  }

  if (pronto) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center text-slate-900">
        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
        <h1 className="text-lg font-semibold text-slate-800">Senha criada</h1>
        <p className="text-sm text-slate-600">Entrando no app…</p>
      </div>
    )
  }

  /**
   * Link vencido ou já usado. Sem esta tela o convite expirado caía direto na
   * sessão de quem já estava logado no aparelho, sem explicar nada.
   */
  if (!convite) {
    return (
      <div className="min-h-screen bg-slate-100 p-4">
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-slate-800">
              <KeyRound className="h-5 w-5" />
              <h1 className="text-lg font-semibold">Convite não serve mais</h1>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-slate-600">
              {erro ?? 'Este link de convite não é válido ou já expirou.'}
            </p>
            <button
              type="button"
              onClick={() => {
                // limpa o erro da URL: sem isso a tela reabre a cada recarga
                window.history.replaceState(null, '', window.location.pathname)
                onSairParaLogin()
              }}
              className="w-full rounded-xl bg-blue-700 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900"
            >
              Entrar com minha senha
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              Sem senha ainda? Peça ao administrador para reenviar o convite.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    /**
     * Mesmo padrão visual das outras telas: fundo claro, cartão branco com
     * borda, campos brancos com texto escuro e borda azul no foco. Antes o
     * campo era `bg-transparent` com texto claro do tema escuro — na página
     * branca o técnico digitava e não via nada.
     */
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-2 text-slate-800">
          <KeyRound className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Criar sua senha</h1>
        </div>

        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-5 text-sm text-slate-600">
            Você foi convidado para as fichas de medição. Escolha uma senha — é com ela que você
            entra no app.
          </p>

          <label
            htmlFor="nova-senha"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Nova senha
          </label>
          <div className="mb-4 flex items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-3 py-2.5 focus-within:border-blue-600">
            <input
              id="nova-senha"
              type={verSenha ? 'text' : 'password'}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Escolha uma senha"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setVerSenha((v) => !v)}
              aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 active:bg-slate-200"
            >
              {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <label
            htmlFor="repetir-senha"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Repita a nova senha
          </label>
          <input
            id="repetir-senha"
            type={verSenha ? 'text' : 'password'}
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            className="mb-4 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600"
            placeholder="Repita a senha"
            autoComplete="new-password"
          />

          {erro && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>
          )}

          <button
            type="button"
            onClick={salvar}
            disabled={ocupado || !convite}
            className="w-full rounded-xl bg-blue-700 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 disabled:opacity-50"
          >
            {ocupado ? 'Salvando…' : 'Criar senha'}
          </button>
        </div>
      </div>
    </div>
  )
}
