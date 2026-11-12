import { useState } from 'react'
import { LogIn, LogOut, Lock, ShieldCheck, User as UserIcon } from 'lucide-react'
import { lerPessoas } from '../lib/cadastros'
import type { Sessao } from '../lib/sessao'
import { useEffect } from 'react'
import type { Pessoa } from '../lib/cadastros'

interface Props {
  sessao: Sessao | null
  /** resultado real da checagem de nível (a sessão sozinha pode estar desatualizada) */
  ehAdministrador: boolean
  onEntrar: (sessao: Sessao) => void
  onSair: () => void
}

/**
 * Identificação de quem está executando. O RG é a credencial de campo: escolhe a
 * pessoa ativa cadastrada. Administrador mantém cadastros e apaga execuções;
 * usuário só executa. A sessão vale no aparelho até alguém sair.
 */
export default function SeletorSessao({ sessao, ehAdministrador, onEntrar, onSair }: Props) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [aberto, setAberto] = useState(false)
  const [rg, setRg] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!aberto) return
    void lerPessoas().then((lista) => setPessoas(lista.filter((p) => p.ativo)))
  }, [aberto])

  if (sessao) {
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
          onClick={onSair}
          className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 active:bg-slate-100"
        >
          <span className="flex items-center gap-1">
            <LogOut size={12} /> Sair
          </span>
        </button>
      </div>
    )
  }

  const entrar = (pessoa: Pessoa) => {
    onEntrar({
      pessoaId: pessoa.id,
      nome: pessoa.nome,
      rg: pessoa.rg,
      nivel: pessoa.nivel,
    })
    setAberto(false)
    setRg('')
    setErro(null)
  }

  const tentar = () => {
    const termo = rg.trim()
    if (!termo) return
    const achado = pessoas.find((p) => p.rg.trim() === termo)
    if (!achado) {
      setErro('RG não encontrado entre os funcionários ativos.')
      return
    }
    entrar(achado)
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
          <div className="flex gap-2">
            <input
              value={rg}
              onChange={(e) => {
                setRg(e.target.value)
                setErro(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') tentar()
              }}
              placeholder="RG"
              inputMode="numeric"
              className="min-w-0 flex-1 rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
            />
            <button
              onClick={tentar}
              className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"
            >
              Entrar
            </button>
          </div>

          {erro && <p className="text-[11px] font-medium text-red-700">{erro}</p>}

          {pessoas.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {pessoas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => entrar(p)}
                  className="flex w-full items-center gap-2 border-b border-slate-100 px-2.5 py-2 text-left last:border-0 active:bg-blue-50"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-800">{p.nome}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">RG {p.rg}</span>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setAberto(false)
              setErro(null)
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
