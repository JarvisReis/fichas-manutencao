import { useState } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, X } from 'lucide-react'
import { trocarSenha } from '../lib/auth'

interface Props {
  /** e-mail de quem está logado, só para exibir "trocando a senha de…" */
  email?: string
  onVoltar: () => void
}

/**
 * Troca da própria senha.
 *
 * Três campos na ordem em que a pessoa pensa: a senha que ela usa agora, a nova,
 * e a confirmação. Sem "mostrar senha" ninguém consegue conferir se digitou
 * certo num teclado de celular — por isso o olho em cada campo.
 *
 * Depois de trocar, a tela NÃO desloga: a sessão continua válida, e derrubar
 * quem acabou de trocar a senha só assustaria. O aviso diz que os outros
 * aparelhos seguem logados até expirarem.
 */
export function TelaSenha({ email, onVoltar }: Props) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [ver, setVer] = useState<Record<'atual' | 'nova' | 'confirma', boolean>>({
    atual: false,
    nova: false,
    confirma: false,
  })
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const podeEnviar = atual.length > 0 && nova.length >= 6 && confirma.length > 0 && !enviando

  const enviar = async () => {
    setErro(null)
    if (nova !== confirma) {
      setErro('A confirmação não bate com a nova senha.')
      return
    }
    setEnviando(true)
    try {
      const r = await trocarSenha(atual, nova)
      if (!r.ok) {
        setErro(r.erro ?? 'Não foi possível trocar a senha.')
        return
      }
      setPronto(true)
      setAtual('')
      setNova('')
      setConfirma('')
    } finally {
      setEnviando(false)
    }
  }

  const campo = (
    chave: 'atual' | 'nova' | 'confirma',
    rotulo: string,
    valor: string,
    aoMudar: (v: string) => void,
    dica?: string,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{rotulo}</span>
      <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-blue-600">
        <input
          type={ver[chave] ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={chave === 'atual' ? 'current-password' : 'new-password'}
          className="w-full bg-transparent py-2.5 text-sm text-slate-800 outline-none"
          placeholder={dica}
        />
        <button
          type="button"
          onClick={() => setVer((v) => ({ ...v, [chave]: !v[chave] }))}
          className="p-1 text-slate-400 active:text-slate-600"
          aria-label={ver[chave] ? `Ocultar ${rotulo.toLowerCase()}` : `Mostrar ${rotulo.toLowerCase()}`}
        >
          {ver[chave] ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  )

  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={onVoltar} className="rounded-xl p-2 text-slate-600 active:bg-slate-100" aria-label="Voltar">
            <ArrowLeft size={22} />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-900">Trocar senha</h1>
            {email && <p className="text-[11px] text-slate-500">{email}</p>}
          </div>
        </div>
      </header>

      <div className="space-y-4 p-4">
        {pronto ? (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-emerald-800">
              <Check size={18} />
              <span className="text-sm font-bold">Senha trocada</span>
            </div>
            <p className="mt-2 text-xs text-emerald-900">
              Use a nova senha no próximo acesso. Este aparelho continua logado; os outros seguem
              valendo até a sessão deles expirar.
            </p>
            <button
              onClick={onVoltar}
              className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white active:scale-[0.99]"
            >
              Voltar
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-slate-700">
                <KeyRound size={18} />
                <span className="text-sm font-semibold">Nova senha</span>
              </div>

              <div className="space-y-3">
                {campo('atual', 'Senha atual', atual, setAtual)}
                {campo('nova', 'Nova senha', nova, setNova, 'mínimo 6 caracteres')}
                {campo('confirma', 'Repita a nova senha', confirma, setConfirma)}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                A senha protege as fichas do time inteiro. Evite algo óbvio como 12345678.
              </p>
            </div>

            {erro && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-medium text-red-900">
                <X size={16} className="mt-0.5 shrink-0" />
                <span className="flex-1">{erro}</span>
                <button onClick={() => setErro(null)} className="font-bold">ok</button>
              </div>
            )}

            <button
              onClick={() => void enviar()}
              disabled={!podeEnviar}
              className="w-full rounded-xl bg-blue-700 py-3 text-sm font-bold text-white active:scale-[0.99] disabled:bg-slate-300"
            >
              {enviando ? 'Trocando…' : 'Trocar senha'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
