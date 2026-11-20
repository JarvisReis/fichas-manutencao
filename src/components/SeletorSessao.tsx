import { useState } from 'react'
import { Eye, EyeOff, LogIn, LogOut, Lock, ShieldCheck, User as UserIcon } from 'lucide-react'
import type { Sessao } from '../lib/sessao'
import { entrarComSenha, sairConta, supabaseConfigurado } from '../lib/auth'

interface Props {
  sessao: Sessao | null
  /** resultado real da checagem de nível (a sessão sozinha pode estar desatualizada) */
  ehAdministrador: boolean
  onEntrar: (sessao: Sessao) => void
  onSair: () => void
  /**
   * Versão de uma linha só, sem moldura: vai dentro do cabeçalho azul da home.
   * Fora dela, o componente mantém a caixa branca com o aviso de identificação.
   */
  compacto?: boolean
}

/**
 * Identificação de quem está executando.
 *
 * Agora é e-mail e senha, conferidos pelo Supabase — a credencial de campo
 * deixou de ser o RG. O RG continua sendo o que aparece na ficha e no
 * histórico, mas ele não prova identidade: qualquer um digitaria R221221.
 * A senha, sim.
 *
 * O nível (administrador/usuário) vem de `perfis`, não da tela. Quem não tem
 * perfil ativo não entra.
 */
export default function SeletorSessao({
  sessao,
  ehAdministrador,
  onEntrar,
  onSair,
  compacto = false,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const configurado = supabaseConfigurado()

  /**
   * Entra de verdade: o Supabase confere a senha e devolve o token; o perfil
   * (nome, RG, nível) vem da tabela `perfis`. Só então a sessão local nasce.
   *
   * Sem perfil a pessoa não passa — ter conta no Auth não é o mesmo que fazer
   * parte do time. É o administrador que cria o perfil.
   */
  const tentar = async () => {
    setErro(null)
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.')
      return
    }
    setOcupado(true)
    try {
      const login = await entrarComSenha(email.trim(), senha)
      if (!login.ok) {
        setErro(login.erro ?? 'Não foi possível entrar.')
        return
      }
      // `entrarComSenha` já devolveu o perfil conferido: reler aqui só abriria
      // espaço para a sessão antiga responder no lugar do login novo.
      const perfil = login.perfil
      if (!perfil) {
        await sairConta()
        setErro('Este e-mail não tem perfil no sistema. Fale com o administrador.')
        return
      }
      onEntrar({
        pessoaId: login.id ?? '',
        nome: perfil.nome,
        rg: perfil.rg,
        nivel: perfil.nivel,
      })
      setAberto(false)
      setEmail('')
      setSenha('')
    } finally {
      setOcupado(false)
    }
  }

  /** Sair encerra a sessão local E a do Supabase, senão o token fica válido. */
  const sair = () => {
    void sairConta()
    onSair()
  }

  if (sessao) {
    if (compacto) {
      return (
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/15 px-2.5 py-1.5 text-white">
          <span className="shrink-0">
            {ehAdministrador ? <ShieldCheck size={14} /> : <UserIcon size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold leading-tight">{sessao.nome}</p>
            <p className="truncate text-[10px] leading-tight text-blue-100">
              RG {sessao.rg} · {ehAdministrador ? 'administrador' : 'usuário'}
            </p>
          </div>
          <button
            onClick={onSair}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-white/20 px-1.5 py-1 text-[10px] font-semibold text-white active:bg-white/30"
          >
            <LogOut size={11} /> Sair
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            ehAdministrador ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {ehAdministrador ? <ShieldCheck size={16} /> : <UserIcon size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-900">{sessao.nome}</p>
          <p className="truncate text-[11px] text-slate-500">
            RG {sessao.rg} · {ehAdministrador ? 'administrador' : 'usuário'}
          </p>
        </div>
        <button
          onClick={sair}
          className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 active:bg-slate-100"
        >
          <span className="flex items-center gap-1">
            <LogOut size={12} /> Sair
          </span>
        </button>
      </div>
    )
  }

  // Sem sessão no cabeçalho: um botão só, na cor do header, sem caixa de aviso.
  // O aviso completo aparece quando o técnico aperta.
  if (compacto) {
    if (!aberto) {
      return (
        <button
          onClick={() => setAberto(true)}
          className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white active:bg-white/25"
        >
          <LogIn size={13} /> Identificar-se
        </button>
      )
    }
    return (
      <div className="flex-1 space-y-2 rounded-xl bg-white/15 p-2">
        <input
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErro(null)
          }}
          placeholder="e-mail"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          className="w-full rounded-lg px-2 py-1.5 text-sm text-slate-900 outline-none"
        />
        <div className="flex gap-1.5">
          <input
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value)
              setErro(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void tentar()
            }}
            placeholder="senha"
            type={verSenha ? 'text' : 'password'}
            className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm text-slate-900 outline-none"
          />
          <button
            type="button"
            onClick={() => setVerSenha((v) => !v)}
            className="shrink-0 rounded-lg bg-white/20 px-2 text-white"
            aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {verSenha ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={() => void tentar()}
            disabled={ocupado}
            className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 disabled:opacity-60"
          >
            {ocupado ? '…' : 'Entrar'}
          </button>
        </div>
        {erro && <p className="text-[10px] font-medium text-amber-100">{erro}</p>}
      </div>
    )
  }


  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-900">
        <Lock size={14} className="mt-0.5 shrink-0" />
        Identifique-se para registrar quem executa. Cadastros e exclusões ficam com o
        administrador.
      </p>

      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white"
        >
          <LogIn size={14} /> Identificar-se
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErro(null)
            }}
            placeholder="e-mail"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
          />

          <div className="flex gap-2">
            <input
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value)
                setErro(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void tentar()
              }}
              placeholder="senha"
              type={verSenha ? 'text' : 'password'}
              className="min-w-0 flex-1 rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
            />
            <button
              type="button"
              onClick={() => setVerSenha((v) => !v)}
              className="shrink-0 rounded-lg border-2 border-slate-300 bg-white px-2.5 text-slate-600"
              aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {verSenha ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <button
            onClick={() => void tentar()}
            disabled={ocupado}
            className="w-full rounded-lg bg-blue-700 py-2.5 text-xs font-semibold text-white disabled:bg-slate-300"
          >
            {ocupado ? 'Entrando…' : 'Entrar'}
          </button>

          {!configurado && (
            <p className="rounded-lg bg-amber-100 p-2 text-[10px] leading-snug text-amber-900">
              Este app foi gerado sem o endereço do servidor. Entre em contato com o
              administrador.
            </p>
          )}

          {erro && <p className="text-[11px] font-medium text-red-700">{erro}</p>}

          <button
            onClick={() => {
              setAberto(false)
              setErro(null)
              setSenha('')
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-1.5 text-[11px] font-semibold text-slate-600"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
