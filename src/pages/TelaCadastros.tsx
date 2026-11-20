import { useEffect, useState } from 'react'
import { ArrowLeft, ClipboardList, Mail, Pencil, Plus, Trash2, Users, Wrench, X } from 'lucide-react'
import { FICHAS, definirFichasEmVigor, getFicha } from '../config/fichas'
import EditorFichas from './EditorFichas'
import {
  fichasEmVigor,
  gravarAutorPublicacao,
  gravarFichasAjustadas,
  gravarVersaoAplicada,
  lerFichasAjustadas,
  lerPublicacaoDeFichas,
  lerPublicacaoPendente,
  marcarPublicacaoPendente,
  type FichasAjustadas,
} from '../lib/fichasEditadas'
import {
  gravarEquipamentos,
  gravarPessoas,
  lerEquipamentos,
  lerPessoas,
  novoId,
  rgEmUso,
  rgValido,
  situacaoAcesso,
  type Equipamento,
  type NivelAcesso,
  type Pessoa,
} from '../lib/cadastros'
import { ShieldCheck, User as UserIcon, CloudUpload, CloudOff } from 'lucide-react'
import { db, fichaZerada } from '../lib/db'
import { enviarEquipamentos, enviarPessoas, publicarAjustesDeFichas } from '../lib/sync'
import { convidarTecnico, reenviarConvite } from '../lib/auth'
import { emailValido } from '../lib/cadastros'
import { gravarVersao } from '../lib/cadastros'
import { obterEndpointAdmin } from '../lib/sync'

type Aba = 'equipamentos' | 'equipe' | 'fichas'

interface Props {
  onVoltar: () => void
  /** nome de quem está logado como administrador (mostrado no cabeçalho) */
  administrador?: string
  /** abre direto numa seção (o atalho "Editar ficha" cai no editor de fichas) */
  abaInicial?: Aba
}

export default function TelaCadastros({ onVoltar, administrador, abaInicial }: Props) {
  const [aba, setAba] = useState<Aba>(abaInicial ?? 'equipe')
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [ajustesFichas, setAjustesFichas] = useState<FichasAjustadas>({})
  /**
   * Quem publicou a versão em vigor das fichas.
   *
   * Limite de medição revisado sem autor e sem data não passa em auditoria: o
   * técnico tem que poder ver de quem é a régua que ele está usando.
   */
  const [publicacao, setPublicacao] = useState<{ autor: string | null; em: string | null }>({
    autor: null,
    em: null,
  })
  const [publicacaoPendente, setPublicacaoPendente] = useState(false)
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    void (async () => {
      setEquipamentos(await lerEquipamentos())
      setPessoas(await lerPessoas())
      setAjustesFichas(await lerFichasAjustadas())
      setPublicacao(await lerPublicacaoDeFichas())
      setPublicacaoPendente(await lerPublicacaoPendente())
      setCarregado(true)
    })()
  }, [])

  /**
   * Cadastro só conta como salvo quando o servidor confirma. Sem servidor
   * configurado (ou sem rede) o app grava local e avisa que a equipe não viu.
   */
  const [avisoEnvio, setAvisoEnvio] = useState<{ erro: boolean; texto: string } | null>(null)

  const publicar = async (
    caminho: () => Promise<{ ok: boolean; versao?: number; erro?: string }>,
    local: () => Promise<void>,
  ) => {
    await local()
    const endpoint = obterEndpointAdmin()
    if (!endpoint) {
      setAvisoEnvio({
        erro: true,
        texto: 'Salvo só neste aparelho: cadastre o endereço do servidor em Backup → Sincronização.',
      })
      return
    }
    setAvisoEnvio(null)
    const r = await caminho()
    if (r.ok) {
      if (r.versao) await gravarVersao(r.versao)
      setAvisoEnvio({ erro: false, texto: `Publicado para a equipe (versão ${r.versao ?? '?'}).` })
    } else {
      setAvisoEnvio({ erro: true, texto: `Salvo no aparelho, mas não foi publicado: ${r.erro}` })
    }
  }

  const salvarPessoas = async (lista: Pessoa[]) => {
    setPessoas(lista)
    await publicar(
      () => enviarPessoas(obterEndpointAdmin(), lista),
      () => gravarPessoas(lista),
    )
  }

  /**
   * Equipamento novo nasce com a ficha zerada na lista: o técnico não precisa
   * "criar" a primeira manutenção, ela já aparece como rascunho na home e no
   * histórico. Equipamento que só foi editado não ganha ficha nova.
   */
  const salvarEquipamentos = async (lista: Equipamento[]) => {
    const anteriores = new Set(equipamentos.map((e) => e.id))
    const novos = lista.filter((e) => !anteriores.has(e.id))
    setEquipamentos(lista)
    for (const equip of novos) {
      const ficha = getFicha(equip.fichaId)
      if (!ficha) continue
      const jaTem = await db.execucoes
        .where('fichaId')
        .equals(ficha.id)
        .filter((e) => (e.camposFixos.equipamento ?? '').trim() === equip.nome.trim())
        .count()
      if (jaTem === 0) await db.execucoes.put(fichaZerada(equip, ficha))
    }
    await publicar(
      () => enviarEquipamentos(obterEndpointAdmin(), lista),
      () => gravarEquipamentos(lista),
    )
  }

  /**
   * Salvar a ficha publica a nova versão para a equipe.
   *
   * Antes o ajuste ficava só neste aparelho: o limite revisado pelo
   * administrador não chegava em ninguém, e cada técnico media por uma régua
   * diferente sem nada avisando. Numa ficha de conformidade isso é grave — o
   * "conforme" de um aparelho não valia no outro.
   *
   * Sem rede, o ajuste vale aqui na hora e fica marcado como pendente: a
   * próxima sincronização publica antes de baixar qualquer coisa.
   */
  const salvarFichas = async (ajustes: FichasAjustadas) => {
    setAjustesFichas(ajustes)
    await gravarFichasAjustadas(ajustes)
    // A ficha em vigor muda na hora: sem isso a tela de execução continuaria
    // com a definição antiga até recarregar.
    definirFichasEmVigor(fichasEmVigor(ajustes))
    await marcarPublicacaoPendente(true)
    const envio = await publicarAjustesDeFichas(obterEndpointAdmin(), ajustes)
    if (envio.ok) {
      await marcarPublicacaoPendente(false)
      setPublicacaoPendente(false)
      const em = envio.atualizadoEm ?? new Date().toISOString()
      if (envio.atualizadoEm) await gravarVersaoAplicada(envio.atualizadoEm)
      await gravarAutorPublicacao(envio.autor ?? null)
      setPublicacao({ autor: envio.autor ?? publicacao.autor, em })
      setAvisoEnvio({
        erro: false,
        texto: 'Ficha publicada para a equipe — os outros aparelhos recebem na próxima sincronização.',
      })
    } else {
      setPublicacaoPendente(true)
      setAvisoEnvio({
        erro: true,
        texto: `Ficha salva neste aparelho. Publicação pendente (${envio.erro ?? 'sem rede'}).`,
      })
    }
  }

  if (!carregado) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Carregando…
      </div>
    )
  }

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Cadastros</p>
            <p className="text-xs text-slate-500">
              Equipamentos e equipe{administrador ? ` · ${administrador}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setAba('equipe')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              aba === 'equipe' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Users size={15} /> Funcionários ({pessoas.length})
          </button>
          <button
            onClick={() => setAba('equipamentos')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              aba === 'equipamentos' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Wrench size={15} /> Equipamentos ({equipamentos.length})
          </button>
          <button
            onClick={() => setAba('fichas')}
            className={`col-span-2 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              aba === 'fichas' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <ClipboardList size={15} /> Fichas de medição
          </button>
        </div>
      </header>

      <div className="p-4">
        {avisoEnvio && (
          <div
            className={`mb-3 flex items-start gap-2 rounded-xl border-2 p-3 text-[11px] font-medium ${
              avisoEnvio.erro
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-emerald-300 bg-emerald-50 text-emerald-900'
            }`}
          >
            {avisoEnvio.erro ? (
              <CloudOff size={14} className="mt-0.5 shrink-0" />
            ) : (
              <CloudUpload size={14} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{avisoEnvio.texto}</span>
            <button onClick={() => setAvisoEnvio(null)} aria-label="Fechar aviso">
              <X size={14} />
            </button>
          </div>
        )}
        {aba === 'equipe' ? (
          <EditorPessoas pessoas={pessoas} onSalvar={salvarPessoas} />
        ) : aba === 'equipamentos' ? (
          <EditorEquipamentos equipamentos={equipamentos} onSalvar={salvarEquipamentos} />
        ) : (
          <>
            <div
              className={`mb-3 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${
                publicacaoPendente
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              {publicacaoPendente ? (
                <span className="font-semibold">
                  Há alteração salva neste aparelho que ainda não foi publicada para a equipe.
                </span>
              ) : publicacao.em ? (
                <>
                  <span className="font-semibold text-slate-800">Versão em vigor</span> publicada por{' '}
                  <span className="font-semibold">{publicacao.autor || 'administrador'}</span> em{' '}
                  {dataHoraCurta(publicacao.em)}.
                </>
              ) : (
                <>
                  Nenhuma revisão publicada ainda — todas as fichas seguem o padrão do aplicativo.
                </>
              )}
            </div>
            <EditorFichas ajustes={ajustesFichas} onSalvar={salvarFichas} />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Data curta no fuso do aparelho.
 *
 * O carimbo da publicação vem em UTC. Mostrar o ISO cru obrigaria o técnico a
 * fazer conta de fuso para saber quando o limite dele foi revisado.
 */
function dataHoraCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* ------------------------------- Funcionários ------------------------------ */

function EditorPessoas({
  pessoas,
  onSalvar,
}: {
  pessoas: Pessoa[]
  onSalvar: (lista: Pessoa[]) => void
}) {
  const [editando, setEditando] = useState<Pessoa | null>(null)

  const salvar = (pessoa: Pessoa) => {
    const existe = pessoas.some((p) => p.id === pessoa.id)
    onSalvar(existe ? pessoas.map((p) => (p.id === pessoa.id ? pessoa : p)) : [...pessoas, pessoa])
    setEditando(null)
  }

  const alternarStatus = (pessoa: Pessoa) => {
    onSalvar(pessoas.map((p) => (p.id === pessoa.id ? { ...p, ativo: !p.ativo } : p)))
  }

  const [confirmando, setConfirmando] = useState<{ id: string; nome: string } | null>(null)

  const excluir = (pessoa: Pessoa) => {
    onSalvar(pessoas.filter((p) => p.id !== pessoa.id))
    setConfirmando(null)
  }

  const ordenadas = [...pessoas].sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })

  /** Quantos dependem de ação do administrador para entrar no app. */
  const pendentesAcesso = pessoas.filter((p) => situacaoAcesso(p) === 'convite-pendente').length
  const semAcesso = pessoas.filter((p) => situacaoAcesso(p) === 'sem-acesso').length

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
        Nome, RG e status. Somente funcionários <strong>ativos</strong> aparecem na seleção da
        equipe durante a execução — quem sai de férias ou é transferido pode ser desativado sem
        perder o histórico.
        <span className="mt-1 block">
          <strong>Equipe</strong> e <strong>acesso ao app</strong> são separados: dá para estar na
          ficha sem ter conta. Só quem tem e-mail e aceitou o convite entra no app.
        </span>
      </p>

      {(pendentesAcesso > 0 || semAcesso > 0) && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          {pendentesAcesso > 0 && (
            <>
              <strong>{pendentesAcesso}</strong>{' '}
              {pendentesAcesso === 1 ? 'pessoa tem' : 'pessoas têm'} convite pendente —{' '}
              {pendentesAcesso === 1 ? 'ela ainda não' : 'elas ainda não'} criou a senha.
              Reenvie tocando em ✏️.
            </>
          )}
          {pendentesAcesso > 0 && semAcesso > 0 && ' '}
          {semAcesso > 0 && (
            <>
              <strong>{semAcesso}</strong> {semAcesso === 1 ? 'pessoa é' : 'pessoas são'} só
              equipe, sem acesso ao app.
            </>
          )}
        </p>
      )}

      {editando && (
        <FormularioPessoa
          pessoa={editando}
          pessoas={pessoas}
          onSalvar={salvar}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando && (
        <button
          onClick={() =>
            setEditando({
              id: novoId(),
              nome: '',
              rg: '',
              funcao: '',
              nivel: 'usuario',
              ativo: true,
            })
          }
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white"
        >
          <Plus size={18} /> Novo funcionário
        </button>
      )}

      {ordenadas.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
          Nenhum funcionário cadastrado. Comece cadastrando a equipe que executa as medições.
        </p>
      ) : (
        <div className="space-y-2">
          {ordenadas.map((pessoa) => (
            <div
              key={pessoa.id}
              className={`flex items-center gap-2 rounded-xl border-2 bg-white p-3 ${
                pessoa.ativo ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{pessoa.nome}</p>
                <p className="truncate text-[11px] text-slate-500">
                  RG {pessoa.rg}
                  {pessoa.funcao ? ` · ${pessoa.funcao}` : ''}
                </p>
                <p
                  className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    pessoa.nivel === 'administrador'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {pessoa.nivel === 'administrador' ? (
                    <ShieldCheck size={10} />
                  ) : (
                    <UserIcon size={10} />
                  )}
                  {pessoa.nivel === 'administrador' ? 'ADMINISTRADOR' : 'USUÁRIO'}
                </p>
                {/*
                  Equipe e acesso são coisas diferentes: quem não tem e-mail
                  entra nas fichas mas não abre o app. Sem este selo o
                  administrador convidava sem saber, ou achava que a pessoa já
                  estava usando.
                */}
                <AcessoPessoa pessoa={pessoa} />
              </div>

              <button
                onClick={() => alternarStatus(pessoa)}
                className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-bold ${
                  pessoa.ativo
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {pessoa.ativo ? 'ATIVO' : 'INATIVO'}
              </button>

              <button
                onClick={() => setEditando(pessoa)}
                className="shrink-0 rounded-lg p-2 text-slate-500 active:bg-slate-100"
                aria-label={`Editar ${pessoa.nome}`}
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => setConfirmando({ id: pessoa.id, nome: pessoa.nome })}
                className="shrink-0 rounded-lg p-2 text-red-600 active:bg-red-50"
                aria-label={`Excluir ${pessoa.nome}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmando && (
        <ConfirmarExclusao
          rotulo="funcionário"
          nome={confirmando.nome}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={() =>
            excluir(pessoas.find((p) => p.id === confirmando.id) ?? { id: confirmando.id } as Pessoa)
          }
        />
      )}
    </div>
  )
}

/** Selo do que a pessoa pode fazer: só assinar a ficha ou também entrar no app. */
function AcessoPessoa({ pessoa }: { pessoa: Pessoa }) {
  const situacao = situacaoAcesso(pessoa)
  const estilo = {
    ativo: 'bg-emerald-100 text-emerald-800',
    'convite-pendente': 'bg-amber-100 text-amber-900',
    'sem-acesso': 'bg-slate-100 text-slate-500',
    inativo: 'bg-slate-100 text-slate-400',
  }[situacao]
  const rotulo = {
    ativo: 'ACESSA O APP',
    'convite-pendente': 'CONVITE PENDENTE',
    'sem-acesso': 'SÓ EQUIPE',
    inativo: 'INATIVO',
  }[situacao]
  return (
    <span
      className={`ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${estilo}`}
    >
      {situacao === 'ativo' ? <Mail size={10} /> : <UserIcon size={10} />}
      {rotulo}
    </span>
  )
}

function FormularioPessoa({
  pessoa,
  pessoas,
  onSalvar,
  onCancelar,
}: {
  pessoa: Pessoa
  pessoas: Pessoa[]
  onSalvar: (pessoa: Pessoa) => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(pessoa.nome)
  const [rg, setRg] = useState(pessoa.rg)
  // O input mostra só os dígitos; o estado guarda o RG completo com o "R".
  const digitosRg = rg.replace(/^R/i, '')
  const [email, setEmail] = useState(pessoa.email ?? '')
  const [convidando, setConvidando] = useState(false)
  /** Convite já saiu: o cadastro está feito e não há o que salvar por fora. */
  const [convidou, setConvidou] = useState(false)
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [funcao, setFuncao] = useState(pessoa.funcao ?? '')
  const [nivel, setNivel] = useState<NivelAcesso>(pessoa.nivel ?? 'usuario')
  const [ativo, setAtivo] = useState(pessoa.ativo)

  /**
   * RG é único por funcionário: é o número que identifica a pessoa na empresa.
   * Dois cadastros com o mesmo RG divide o histórico de duas pessoas em uma,
   * e depois ninguém sabe de quem é a manutenção.
   */
  const rgDuplicado = rgEmUso(rg, pessoas, pessoa.id)
  const valido = nome.trim().length > 0 && rgValido(rg) && !rgDuplicado
  // Só cobra o formato quando o campo já tem conteúdo — senão a tela nasce
  // em vermelho num formulário em branco.
  const rgInvalido = digitosRg.trim().length > 0 && !rgValido(rg)

  /**
   * Manda o convite agora, sem esperar o "Salvar": o técnico já recebe o
   * e-mail enquanto o administrador termina o cadastro. Se a conta já existir,
   * o botão vira "reenviar", porque o caso comum é o convite ter expirado na
   * caixa de entrada.
   */
  const convidar = async () => {
    setConvidando(true)
    setRecado(null)
    try {
      const primeiro = await convidarTecnico(email, {
        nome: nome.trim(),
        rg: rg.trim().toUpperCase(),
        funcao: funcao.trim() || undefined,
        nivel,
        ativo,
      })
      if (primeiro.ok) {
        setConvidou(true)
        setRecado({
          ok: true,
          texto: `Convite enviado para ${email.trim()}. ${nome.trim()} cria a senha pelo link e já entra com este cadastro.`,
        })
        return
      }
      const jaTem = /já tem conta/i.test(primeiro.erro ?? '')
      if (jaTem) {
        const segundo = await reenviarConvite(email)
        setRecado(
          segundo.ok
            ? { ok: true, texto: `Conta já existia. Reenviei o e-mail para ${email.trim()}.` }
            : { ok: false, texto: segundo.erro ?? 'Não foi possível reenviar.' },
        )
        return
      }
      setRecado({ ok: false, texto: primeiro.erro ?? 'Não foi possível convidar.' })
    } finally {
      setConvidando(false)
    }
  }

  return (
    <div className="rounded-xl border-2 border-blue-600 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-slate-900">
          {pessoa.nome ? 'Editar funcionário' : 'Novo funcionário'}
        </p>
        <button onClick={onCancelar} aria-label="Fechar">
          <X size={18} className="text-slate-400" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Nome *</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome completo"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">RG *</span>
          {/* O "R" não é digitável: fica fixo à esquerda e o campo guarda só os
              dígitos. Assim ninguém digita letra por engano nem esquece o
              prefixo — o formato é garantido pelo desenho, não pela validação. */}
          <div
            className={`flex items-stretch overflow-hidden rounded-lg border-2 bg-white focus-within:border-blue-600 ${
              rgInvalido ? 'border-red-400' : 'border-slate-300'
            }`}
          >
            <span className="flex select-none items-center border-r-2 border-slate-200 bg-slate-50 px-3 text-base font-bold text-slate-500">
              R
            </span>
            <input
              value={digitosRg}
              onChange={(e) => {
                const digitos = e.target.value.replace(/\D/g, '').slice(0, 6)
                setRg(digitos ? `R${digitos}` : '')
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="221221"
              className={`w-full px-3 py-2.5 text-base text-slate-900 outline-none ${rgInvalido || rgDuplicado ? 'bg-red-50' : ''}`}
            />
          </div>
          {rgInvalido && (
            <span className="mt-1 block text-[11px] font-medium text-red-700">
              RG precisa ter de 5 a 6 números depois do R — ex.: R221221.
            </span>
          )}
          {!rgInvalido && rgDuplicado && (
            <span className="mt-1 block text-[11px] font-medium text-red-700">
              Este RG já é de <strong>{rgDuplicado.nome}</strong>. Cada funcionário
              tem um RG próprio.
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Função (opcional)</span>
          <input
            value={funcao}
            onChange={(e) => setFuncao(e.target.value)}
            placeholder="Ex.: Eletricista de manutenção"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            E-mail de acesso <span className="font-normal text-slate-400">(opcional)</span>
          </span>
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setRecado(null)
            }}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="nome@empresa.com.br"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
          <span className="mt-1 block text-[10px] leading-snug text-slate-500">
            <strong>Em branco:</strong> a pessoa entra na equipe e pode ser escolhida nas fichas,
            mas <strong>não acessa o app</strong>. <strong>Preenchido:</strong> recebe o convite e
            cria a própria senha — você nunca precisa saber a senha dela.
          </span>
        </label>

        {/*
          O convite é o cadastro inteiro: nome, RG e e-mail. Por isso o botão
          só aparece quando o formulário está válido — convidar sem RG criaria
          uma conta que não consegue virar funcionário depois.
        */}
        {emailValido(email) && valido && !convidou && (
          <button
            type="button"
            onClick={() => void convidar()}
            disabled={convidando}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Mail size={15} />
            {convidando ? 'Enviando convite…' : 'Convidar — a pessoa cria a senha pelo link'}
          </button>
        )}

        {recado && (
          <p
            className={`rounded-lg p-2 text-[11px] font-medium ${
              recado.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {recado.texto}
          </p>
        )}

        <div className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">
            Nível de acesso
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { valor: 'usuario' as NivelAcesso, rotulo: 'Usuário', icone: UserIcon },
                {
                  valor: 'administrador' as NivelAcesso,
                  rotulo: 'Administrador',
                  icone: ShieldCheck,
                },
              ] as const
            ).map((opcao) => {
              const Icone = opcao.icone
              const ativoAgora = nivel === opcao.valor
              return (
                <button
                  key={opcao.valor}
                  type="button"
                  onClick={() => setNivel(opcao.valor)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border-2 py-2.5 text-xs font-semibold transition ${
                    ativoAgora
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  <Icone size={14} /> {opcao.rotulo}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-slate-500">
            Administrador mantém cadastros e configurações; usuário apenas executa as fichas.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAtivo((v) => !v)}
          className={`flex w-full items-center justify-between rounded-lg border-2 px-3 py-2.5 text-sm font-semibold ${
            ativo ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-600'
          }`}
        >
          {ativo ? 'Ativo — aparece na seleção' : 'Inativo — oculto na seleção'}
          <span className={`h-5 w-9 rounded-full p-0.5 ${ativo ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span
              className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                ativo ? 'translate-x-4' : ''
              }`}
            />
          </span>
        </button>

        {/*
          Sem convite, "Salvar" só guarda o cadastro no aparelho — e o perfil
          não existe no servidor. Por isso o caminho normal é convidar; o botão
          fica como saída para quem edita um funcionário que já usa o app.
        */}
        {convidou || pessoa.userId ? (
          <button
            onClick={() => onCancelar()}
            className="w-full rounded-lg border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Concluir
          </button>
        ) : (
          <button
            onClick={() =>
              onSalvar({
                ...pessoa,
                nome: nome.trim(),
                rg: rg.trim(),
                email: email.trim().toLowerCase() || undefined,
                funcao: funcao.trim(),
                nivel,
                ativo,
              })
            }
            disabled={!valido}
            className="w-full rounded-lg border-2 border-slate-300 py-2.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
          >
            {/*
              Este é o caminho normal de quem só faz parte da equipe: entra na
              ficha pelo RG, sem conta e sem convite.
            */}
            Salvar sem acesso ao app
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------- Equipamentos ------------------------------ */

function EditorEquipamentos({
  equipamentos,
  onSalvar,
}: {
  equipamentos: Equipamento[]
  onSalvar: (lista: Equipamento[]) => void
}) {
  const [editando, setEditando] = useState<Equipamento | null>(null)

  const salvar = (equip: Equipamento) => {
    const existe = equipamentos.some((e) => e.id === equip.id)
    onSalvar(existe ? equipamentos.map((e) => (e.id === equip.id ? equip : e)) : [...equipamentos, equip])
    setEditando(null)
  }

  const [confirmando, setConfirmando] = useState<{ id: string; nome: string } | null>(null)

  const excluir = (equip: Equipamento) => {
    onSalvar(equipamentos.filter((e) => e.id !== equip.id))
    setConfirmando(null)
  }

  const ordenados = [...equipamentos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
        Cada equipamento aponta para uma ficha. Quando você seleciona um equipamento na execução, o
        app já preenche o local e a série do núcleo. Não é obrigatório — o técnico pode digitar
        livremente se o equipamento não estiver aqui.
      </p>

      {editando && (
        <FormularioEquipamento
          equipamento={editando}
          onSalvar={salvar}
          onCancelar={() => setEditando(null)}
        />
      )}

      {!editando && (
        <button
          onClick={() =>
            setEditando({
              id: novoId(),
              nome: '',
              fichaId: FICHAS[0].id,
              local: '',
              marca: '',
              serie: '',
            })
          }
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold text-white"
        >
          <Plus size={18} /> Novo equipamento
        </button>
      )}

      {ordenados.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
          Nenhum equipamento cadastrado. Cadastre os contatores e seccionadores que você mede com
          frequência.
        </p>
      ) : (
        <div className="space-y-2">
          {ordenados.map((equip) => (
            <div
              key={equip.id}
              className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{equip.nome}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {[equip.local, equip.serie, equip.marca].filter(Boolean).join(' · ') || 'sem detalhes'}
                </p>
                <p className="truncate text-[10px] font-medium text-blue-700">
                  {FICHAS.find((f) => f.id === equip.fichaId)?.nomeCurto ?? equip.fichaId}
                </p>
              </div>
              <button
                onClick={() => setEditando(equip)}
                className="shrink-0 rounded-lg p-2 text-slate-500 active:bg-slate-100"
                aria-label={`Editar ${equip.nome}`}
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => setConfirmando({ id: equip.id, nome: equip.nome })}
                className="shrink-0 rounded-lg p-2 text-red-600 active:bg-red-50"
                aria-label={`Excluir ${equip.nome}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmando && (
        <ConfirmarExclusao
          rotulo="equipamento"
          nome={confirmando.nome}
          onCancelar={() => setConfirmando(null)}
          onConfirmar={() =>
            excluir(
              equipamentos.find((e) => e.id === confirmando.id) ?? ({ id: confirmando.id } as Equipamento),
            )
          }
        />
      )}
    </div>
  )
}

function FormularioEquipamento({
  equipamento,
  onSalvar,
  onCancelar,
}: {
  equipamento: Equipamento
  onSalvar: (equip: Equipamento) => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(equipamento.nome)
  const [fichaId, setFichaId] = useState(equipamento.fichaId)
  const [local, setLocal] = useState(equipamento.local)
  const [marca, setMarca] = useState(equipamento.marca ?? '')
  const [serie, setSerie] = useState(equipamento.serie ?? '')

  const valido = nome.trim().length > 0

  return (
    <div className="rounded-xl border-2 border-blue-600 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-slate-900">
          {equipamento.nome ? 'Editar equipamento' : 'Novo equipamento'}
        </p>
        <button onClick={onCancelar} aria-label="Fechar">
          <X size={18} className="text-slate-400" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Nome *</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: CT 02 — CD1"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Ficha aplicável</span>
          <select
            value={fichaId}
            onChange={(e) => setFichaId(e.target.value)}
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          >
            {FICHAS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nomeCurto}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Local</span>
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Ex.: Linha 2 — CD1"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">Marca</span>
            <input
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder="Sechéron"
              className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">Série do núcleo</span>
            <input
              value={serie}
              onChange={(e) => setSerie(e.target.value)}
              placeholder="HPB001"
              className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>
        </div>

        <button
          onClick={() =>
            onSalvar({
              ...equipamento,
              nome: nome.trim(),
              fichaId,
              local: local.trim(),
              marca: marca.trim(),
              serie: serie.trim(),
            })
          }
          disabled={!valido}
          className="w-full rounded-lg bg-blue-700 py-3 text-sm font-semibold text-white disabled:bg-slate-300"
        >
          Salvar
        </button>
      </div>
    </div>
  )
}

/* ---------------------------- Confirmação ---------------------------- */

function ConfirmarExclusao({
  nome,
  rotulo,
  onCancelar,
  onConfirmar,
}: {
  nome: string
  rotulo: string
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-bold text-slate-900">Excluir {rotulo}?</h2>
        <p className="mt-2 text-sm text-slate-600">
          <strong>{nome}</strong> será apagado do cadastro e não há como desfazer.
          {rotulo === 'funcionário' &&
            ' As fichas já executadas continuam no histórico, mas o nome sai da equipe.'}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancelar}
            className="flex-1 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  )
}
