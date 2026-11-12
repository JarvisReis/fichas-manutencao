import { useEffect, useState } from 'react'
import { ArrowLeft, Pencil, Plus, Trash2, Users, Wrench, X } from 'lucide-react'
import { FICHAS } from '../config/fichas'
import {
  gravarEquipamentos,
  gravarPessoas,
  lerEquipamentos,
  lerPessoas,
  novoId,
  type Equipamento,
  type NivelAcesso,
  type Pessoa,
} from '../lib/cadastros'
import { ShieldCheck, User as UserIcon } from 'lucide-react'

interface Props {
  onVoltar: () => void
  /** nome de quem está logado como administrador (mostrado no cabeçalho) */
  administrador?: string
}

type Aba = 'equipamentos' | 'equipe'

export default function TelaCadastros({ onVoltar, administrador }: Props) {
  const [aba, setAba] = useState<Aba>('equipe')
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    void (async () => {
      setEquipamentos(await lerEquipamentos())
      setPessoas(await lerPessoas())
      setCarregado(true)
    })()
  }, [])

  const salvarPessoas = async (lista: Pessoa[]) => {
    setPessoas(lista)
    await gravarPessoas(lista)
  }

  const salvarEquipamentos = async (lista: Equipamento[]) => {
    setEquipamentos(lista)
    await gravarEquipamentos(lista)
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
        </div>
      </header>

      <div className="p-4">
        {aba === 'equipe' ? (
          <EditorPessoas pessoas={pessoas} onSalvar={salvarPessoas} />
        ) : (
          <EditorEquipamentos equipamentos={equipamentos} onSalvar={salvarEquipamentos} />
        )}
      </div>
    </div>
  )
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

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
        Nome, RG e status. Somente funcionários <strong>ativos</strong> aparecem na seleção da
        equipe durante a execução — quem sai de férias ou é transferido pode ser desativado sem
        perder o histórico.
      </p>

      {editando && (
        <FormularioPessoa
          pessoa={editando}
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

function FormularioPessoa({
  pessoa,
  onSalvar,
  onCancelar,
}: {
  pessoa: Pessoa
  onSalvar: (pessoa: Pessoa) => void
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(pessoa.nome)
  const [rg, setRg] = useState(pessoa.rg)
  const [funcao, setFuncao] = useState(pessoa.funcao ?? '')
  const [nivel, setNivel] = useState<NivelAcesso>(pessoa.nivel ?? 'usuario')
  const [ativo, setAtivo] = useState(pessoa.ativo)

  const valido = nome.trim().length > 0 && rg.trim().length > 0

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
          <input
            value={rg}
            onChange={(e) => setRg(e.target.value)}
            placeholder="Ex.: 09233.9"
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
          />
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

        <button
          onClick={() =>
            onSalvar({
              ...pessoa,
              nome: nome.trim(),
              rg: rg.trim(),
              funcao: funcao.trim(),
              nivel,
              ativo,
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
              placeholder="Schneider"
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
