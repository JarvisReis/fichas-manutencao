import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Info } from 'lucide-react'
import { MARCA_CONTATOR, NOME_MARCA, type DefinicaoFicha, type Execucao, type Marca, type TipoManutencao } from '../types'
import {
  gerarCodigo,
  lerCamposFixos,
  lerEndpointSync,
  lerNucleoInstalado,
  salvarCamposFixos,
} from '../lib/db'
import { lerNucleoDoServidor } from '../lib/sync'
import { identificacaoCompleta, nucleosEmBranco } from '../lib/permissoes'
import {
  lerEquipamentos,
  lerPessoas,
  extrairRgs,
  rgValido,
  type Equipamento,
  type Pessoa,
} from '../lib/cadastros'
import { NUCLEOS_HPB } from '../config/nucleos'
import SeletorEquipamento from '../components/SeletorEquipamento'
import SeletorEquipe from '../components/SeletorEquipe'
import { tipoEmVigor, type Topico, type TopicoDaFicha } from '../lib/topicosFicha'

interface Props {
  ficha: DefinicaoFicha
  execucao: Execucao
  onVoltar: () => void
  onAtualizar: (patch: Partial<Execucao>) => void
  onContinuar: () => void
  /**
   * Abas da ficha em preenchimento — as mesmas da tela de medições.
   *
   * A identificação é um bloco da ficha como outro qualquer, e não uma tela
   * à parte: em campo o técnico volta e mexe na equipe depois de começar.
   */
  topicos: TopicoDaFicha[]
  topico: Topico | null
  onTrocarTopico: (topico: Topico) => void
}

/**
 * Campo de patrimônio de instrumento (`microPatrimonio`, `megaPatrimonio`…).
 *
 * Identificado pelo nome porque a lista de campos vem do modelo da ficha, e é
 * o sufixo que diz o que o campo é — não a posição.
 */
function ehPatrimonio(chave: string): boolean {
  return /patrimonio$/i.test(chave)
}

export default function TelaIdentificacao({
  ficha,
  execucao,
  onVoltar,
  onAtualizar,
  onContinuar,
  topicos,
  topico,
  onTrocarTopico,
}: Props) {
  /**
   * Aba em vigor nesta tela.
   *
   * `tipoEmVigor` cai em `medicoes` quando não há pedido — que é o padrão certo
   * para a tela de execução, e o errado para esta. Sem pedido, aqui o padrão é
   * `identificacao`; senão a tela abria sem nenhum bloco (medições não mora
   * aqui) e só voltava a desenhar depois de trocar de aba na mão.
   */
  const topicoAtivo = tipoEmVigor(
    topicos,
    topico ?? (topicos.some((t) => t.id === 'identificacao') ? 'identificacao' : null),
  )
  const [camposFixos, setCamposFixos] = useState<Record<string, string>>(execucao.camposFixos)
  const [local, setLocal] = useState(execucao.local)
  const [dataHora, setDataHora] = useState(() => paraInputLocal(execucao.dataHora))
  // Manutenção de vários dias (contator = 2): o app já sugere o encerramento
  // em dias-1, mas o técnico ajusta se a parada escorregar.
  const dias = ficha.dias ?? 1
  const [dataFim, setDataFim] = useState(() =>
    paraInputLocal(execucao.dataFim ?? somarDias(execucao.dataHora, dias - 1)),
  )
  // Marca não é escolha: todo contator é Schneider. A execução nasce com o
  // valor gravado, então as telas de medição e a conformidade leem daqui sem
  // precisar de seletor. Execuções antigas com `merlin` mantêm o que têm.
  const [marca] = useState<Marca | undefined>(execucao.marca ?? (ficha.exigeMarca ? MARCA_CONTATOR : undefined))
  // P1 é o padrão: se o técnico não escolher o tipo, a ficha é salva como P1.
  const [tipoManutencao, setTipoManutencao] = useState<TipoManutencao | undefined>(
    execucao.tipoManutencao ?? ficha.tiposManutencao[0],
  )
  const [tipoEscolhido, setTipoEscolhido] = useState(Boolean(execucao.tipoManutencao))
  const [equipamentoNome, setEquipamentoNome] = useState(execucao.camposFixos.equipamento ?? '')
  const [nucleoInstalado, setNucleoInstalado] = useState(execucao.nucleoInstalado ?? '')
  const [nucleoRetirado, setNucleoRetirado] = useState(
    execucao.tipoManutencao === 'P2' ? (execucao.camposFixos.serieRetirado ?? '') : '',
  )
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [avisoEquipe, setAvisoEquipe] = useState<string | null>(null)
  /**
   * Patrimônios usados na última vez, por campo.
   *
   * Ficam separados dos campos da execução de propósito: o app lembra os
   * patrimônios do aparelho, mas não os grava na ficha como se o técnico já
   * tivesse conferido. Antes a memória era mesclada direto no valor, e a ficha
   * nova abria com os patrimônios da manutenção anterior preenchidos — some a
   * diferença entre "veio da última vez" e "conferi agora".
   */
  const [patrimoniosLembrados, setPatrimoniosLembrados] = useState<Record<string, string>>({})
  /** Campos em branco que impediram o Concluir. Lista vazia = nada pendente. */
  const [faltando, setFaltando] = useState<string[]>([])

  // Qualquer edição reabre a conferência: some o aviso de campos em branco.
  useEffect(() => {
    setFaltando([])
  }, [camposFixos, local, nucleoRetirado])

  /**
   * Puxa a memória dos campos fixos do equipamento — menos a equipe.
   *
   * A memória é por ficha (`camposFixos:<fichaId>`), não por execução. Antes ela
   * era mesclada inteira em toda abertura, então uma ficha nova já nascia com os
   * RGs da manutenção anterior marcados: o técnico tinha que desmarcar a dupla
   * antiga antes de montar a sua. Equipe é dado da execução, não do modelo da
   * ficha — vem do que está gravado nesta execução e ponto. Torquímetro e afins
   * continuam vindo da memória, que é onde eles fazem sentido.
   */
  useEffect(() => {
    void (async () => {
      const memoria = await lerCamposFixos(ficha.id)
      const semEquipe = Object.fromEntries(
        Object.entries(memoria).filter(([chave]) => !/^rg\d+$/i.test(chave)),
      )
      // Patrimônio lembrado não entra no valor: vira sugestão ao lado do campo.
      const lembrar: Record<string, string> = {}
      const semPatrimonio: Record<string, string> = {}
      for (const [chave, valor] of Object.entries(semEquipe)) {
        if (ehPatrimonio(chave)) lembrar[chave] = valor
        else semPatrimonio[chave] = valor
      }
      setPatrimoniosLembrados(lembrar)
      setCamposFixos((atual) => ({ ...semPatrimonio, ...atual }))
    })()
  }, [ficha.id])

  // Núcleo instalado: vem da última manutenção do equipamento e só muda na P2.
  // Na P1 o campo fica somente leitura; na P2 é editável (troca de núcleo).
  useEffect(() => {
    const equipamento = (execucao.camposFixos.equipamento ?? '').trim()
    if (!equipamento || execucao.nucleoInstalado) return
    let cancelado = false
    void (async () => {
      // 1) fonte da verdade: tabela de equipamentos no servidor (via proxy)
      const endpoint = lerEndpointSync()
      if (endpoint) {
        const doServidor = await lerNucleoDoServidor(endpoint, equipamento)
        if (cancelado) return
        if (doServidor) {
          setNucleoInstalado(doServidor)
          onAtualizar({ nucleoInstalado: doServidor })
          return
        }
      }
      // 2) sem servidor: última execução registrada neste aparelho
      const anterior = await lerNucleoInstalado(equipamento, {
        id: execucao.id,
        equipamento,
        nucleoInstalado: execucao.nucleoInstalado,
        atualizadaEm: execucao.atualizadaEm,
      })
      if (cancelado || !anterior) return
      setNucleoInstalado(anterior)
      onAtualizar({ nucleoInstalado: anterior })
    })()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarrega quando o equipamento muda
  }, [execucao.camposFixos.equipamento, execucao.nucleoInstalado])

  // Cadastros: relidos ao abrir a tela e sempre que o app volta ao primeiro plano,
  // porque podem ter sido editados na tela de cadastros.
  useEffect(() => {
    const carregar = async () => {
      const [equips, listaPessoas] = await Promise.all([lerEquipamentos(), lerPessoas()])
      setEquipamentos(equips)
      setPessoas(listaPessoas)
    }
    void carregar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [])

  const ehP2 = tipoManutencao === 'P2'

  const salvarCampos = (patch: Partial<Execucao>) =>
    onAtualizar({
      ...patch,
      nucleoInstalado: patch.nucleoInstalado ?? nucleoInstalado,
    })

  /** RGs marcados na equipe viram os campos fixos rg1..rgN, na ordem do cadastro. */
  const selecionarPessoa = (pessoa: Pessoa) => {
    // A pessoa escolhida pode vir do cadastro ainda sem RG preenchido; sem
    // identidade não dá para gravar a equipe e o botão nunca libera.
    const rgLimpo = (pessoa.rg ?? '').trim()
    if (!rgLimpo) {
      setAvisoEquipe('Esta pessoa está sem RG no cadastro. Peça a um administrador para preencher.')
      return
    }
    // Mesma regra do cadastro. Antes daqui a validação era mais dura que a do
    // formulário: RG com letra era gravado e descartado na volta, e o toque
    // simplesmente não marcava — sem mensagem nenhuma.
    if (!rgValido(rgLimpo)) {
      setAvisoEquipe(
        `O RG "${rgLimpo}" não é aceito. O formato é R seguido de 5 ou 6 números — ex.: R221221.`,
      )
      return
    }
    setAvisoEquipe(null)
    const rg = rgLimpo
    const atuais = extrairRgs(camposFixos)
    const jaEsta = atuais.some((r) => r.trim() === rg)
    const proximos = jaEsta ? atuais.filter((r) => r.trim() !== rg) : [...atuais, rg]

    setCamposFixos(reconstruirRgs(camposFixos, proximos))
    salvarCampos({ camposFixos: reconstruirRgs(camposFixos, proximos) })
  }

  /**
   * Remove um RG direto da equipe, sem depender de existir pessoa no cadastro.
   *
   * É o caminho de saída para o RG órfão: o técnico corrigiu o RG no cadastro
   * (ou excluiu a pessoa) e o rascunho ficou com o valor antigo gravado. Antes
   * esse chip aparecia como "—" e o botão de remover não fazia nada, porque
   * removia "alternando" uma pessoa que não existia mais.
   */
  const removerRg = (rg: string) => {
    const alvo = rg.trim()
    const proximos = extrairRgs(camposFixos).filter((r) => r.trim() !== alvo)
    setAvisoEquipe(null)
    setCamposFixos(reconstruirRgs(camposFixos, proximos))
    salvarCampos({ camposFixos: reconstruirRgs(camposFixos, proximos) })
  }

  const selecionarEquipamento = (equipamento: Equipamento | null, texto: string) => {
    setEquipamentoNome(texto)
    // O núcleo instalado não vem do cadastro do equipamento: é lido da última
    // manutenção daquele contator e só é alterado na P2.
    const proximo: Record<string, string> = { ...camposFixos, equipamento: texto }
    if (equipamento?.local) {
      setLocal(equipamento.local)
    }
    setCamposFixos(proximo)
    salvarCampos({
      camposFixos: proximo,
      ...(equipamento?.local ? { local: equipamento.local } : {}),
    })
  }

  // Equipe é obrigatória no mínimo com 2 pessoas: a ficha é preenchida em dupla
  // e o registro precisa identificar quem mediu e quem acompanhou.
  const equipe = extrairRgs(camposFixos)
  const equipeCompleta = equipe.length >= 2
  // Uma regra só, compartilhada com a home e a restauração de rota: se cada
  // tela tivesse a sua, o rascunho barrado aqui abriria em medições ali.
  const podeContinuar = identificacaoCompleta(
    { local, marca, tipoManutencao, camposFixos },
    { exigeMarca: ficha.exigeMarca },
  )

  /** Posição da aba atual na lista, para o rodapé saber se é a última. */
  const indiceTopico = Math.max(0, topicos.findIndex((t) => t.id === topicoAtivo))

  /**
   * Sobrou alguma aba editável depois desta?
   *
   * Medições fica por último, mas não é bloco desta tela: quando só ela resta,
   * andar para frente é concluir. Enquanto houver aba de campo adiante, é
   * "Próximo" — inclusive na última delas (Instrumentos), porque ainda falta
   * medir.
   */
  const temProximaAba = topicos.slice(indiceTopico + 1).some((t) => t.id !== 'medicoes')

  /**
   * "Concluir" só existe onde concluir é verdade.
   *
   * Instrumentos é a última aba **de campo**, mas ainda falta medir: ali o
   * botão diz "Próximo" e abre a tela de medições. Concluir aparece apenas
   * em Medições, que é o destino final.
   */
  const podeConcluirAqui = !temProximaAba && topicoAtivo === 'medicoes'

  /**
   * Medições é a única aba sem bloco nesta tela — os campos de medição vivem
   * na tela de execução. Chegar nela aqui (pelo Próximo, por exemplo) abria
   * uma aba em branco; agora ela segue adiante para a tela que a preenche.
   */
  useEffect(() => {
    if (topicoAtivo === 'medicoes' && podeContinuar) continuar()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à aba
  }, [topicoAtivo])

  /** Aviso do rodapé: por que o botão está travado. */
  const motivoPendencia = !local.trim()
    ? 'Informe o local.'
    : equipe.length < 2
      ? 'Marque no mínimo 2 pessoas da equipe.'
      : ficha.exigeMarca && !marca
        ? 'Informe a marca.'
        : ''

  /**
   * Campos que ficaram em branco nesta ficha.
   *
   * Serve para o Concluir avisar antes de fechar, e não para impedir: às vezes
   * o campo não se aplica ao equipamento, e quem sabe disso é o técnico.
   */
  const camposEmBranco = () => {
    const lista: string[] = []
    for (const campo of camposFixosEditaveis(ficha)) {
      /**
       * Campo que não se aplica a esta execução não conta como pendência:
       * bloquear por algo que o técnico nem pode preencher é armadilha.
       */
      // Núcleo retirado só existe na P2.
      if (campo.id === 'serieRetirado' && !ehP2) continue
      // Núcleos são lidos do próprio estado, não de camposFixos: o seletor de núcleo
      // grava em `nucleoInstalado`/`nucleoRetirado` e só junta tudo em
      // `camposFixos` na hora de sair da tela. Ler daqui dava falso "em branco"
      // com o campo preenchido na cara do técnico, que ficava preso na aba.
      if (campo.id === 'serieInstalado' || campo.id === 'serieRetirado') continue
      if (!(camposFixos[campo.id] ?? '').trim()) lista.push(campo.nome)
    }
    // Núcleos: instalado sempre obrigatório, retirado só na P2.
    lista.push(...nucleosEmBranco(ehP2, nucleoInstalado, nucleoRetirado))
    if (!local.trim()) lista.push('Local')
    if (equipe.length === 0) lista.push('Equipe')
    return lista
  }

  /**
   * Próximo: anda uma aba, sem pular etapas.
   *
   * Na aba Equipe não deixa avançar sem a dupla — é o único bloco em que faltar
   * dado inviabiliza a ficha inteira.
   */
  const irParaProximo = () => {
    if (topicoAtivo === 'equipe' && !equipeCompleta) {
      setAvisoEquipe('Marque no mínimo 2 pessoas da equipe antes de seguir.')
      return
    }
    /**
     * Medições não é bloco desta tela: ao chegar nela, vai direto para a
     * execução. Sem isso o Próximo parava numa aba sem nada para preencher.
     */
    const proximo = topicos.slice(indiceTopico + 1).find((t) => t.id !== 'medicoes')
    if (!proximo) {
      // Fim das abas de campo: o "Próximo" aqui é o Concluir.
      concluirComConferencia()
      return
    }
    onTrocarTopico(proximo.id)
  }

  /**
   * Concluir: bloqueia enquanto houver campo em branco.
   *
   * Antes avisava e deixava seguir. A pedido, agora barra: a ficha é documento
   * de manutenção, e campo vazio na identificação vira ficha sem rastro de
   * quem mediu ou com qual instrumento. O aviso lista o que falta e leva o
   * técnico direto para a aba do primeiro campo pendente.
   */
  const concluirComConferencia = () => {
    if (!podeContinuar) return
    const vazios = camposEmBranco()
    if (vazios.length > 0) setFaltando(vazios)
    else continuar()
  }

  const continuar = () => {
    if (!podeContinuar) return
    // O núcleo retirado só existe na P2; na P1 o campo é descartado.
    const fixosSaida: Record<string, string> = reconstruirRgs(camposFixos, equipe)
    if (ehP2 && nucleoRetirado) fixosSaida.serieRetirado = nucleoRetirado
    else delete fixosSaida.serieRetirado

    /**
     * A memória da ficha guarda o que é do modelo (torquímetro, séries), não a
     * equipe: gravar os RGs aqui é o que fazia a ficha seguinte abrir com a
     * dupla anterior já marcada.
     */
    const semEquipe = Object.fromEntries(
      Object.entries(fixosSaida).filter(([chave]) => !/^rg\d+$/i.test(chave)),
    )
    void salvarCamposFixos(ficha.id, semEquipe)
    const inicio = new Date(dataHora)
    const fim = dias > 1 ? new Date(dataFim) : inicio
    onAtualizar({
      camposFixos: fixosSaida,
      local: local.trim(),
      marca,
      tipoManutencao,
      nucleoInstalado,
      dataHora: inicio.toISOString(),
      dataFim: dias > 1 ? fim.toISOString() : undefined,
      codigo: gerarCodigo(
        equipamentoNome,
        inicio,
        undefined,
        dias > 1 ? fim.toISOString() : undefined,
      ),
    })
    onContinuar()
  }

  return (
    <div className="min-h-full pb-28">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={onVoltar} className="rounded-xl p-2 text-slate-600 active:bg-slate-100" aria-label="Voltar">
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              Identificação
            </p>
            <p className="text-xs text-slate-500">
              {ficha.nomeCurto} · {execucao.codigo}
            </p>
          </div>
        </div>

        {/* As mesmas abas da tela de medições: a identificação é um bloco da
            ficha, não uma tela à parte. */}
        <nav className="flex gap-1 overflow-x-auto pt-2">
          {topicos.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                // Medições não é bloco desta tela: os campos de medição vivem na
                // tela de execução. Aqui a aba só leva para lá — antes ela
                // trocava o tópico e a tela ficava em branco, porque nenhum
                // bloco com esse id era desenhado.
                if (t.id === 'medicoes') {
                  continuar()
                  return
                }
                onTrocarTopico(t.id)
              }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                topicoAtivo === t.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 active:bg-slate-200'
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </nav>
      </header>

      <div className="space-y-4 p-4">
        {/* Cada bloco pertence a uma aba, como na tela de medições. */}
        {topicoAtivo === 'identificacao' && (
        <>
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Equipamento</h3>
          <p className="mb-3 text-xs text-slate-500">
            Busque na lista; se não estiver cadastrado, digite o nome.
          </p>
          <SeletorEquipamento
            equipamentos={equipamentos}
            fichaId={ficha.id}
            valor={equipamentoNome}
            onSelecionar={selecionarEquipamento}
          />
        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Tipo de manutenção</h3>
          {ficha.tiposManutencao.length > 1 ? (
            <>
            <div className="grid grid-cols-2 gap-2">
              {ficha.tiposManutencao.map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => {
                    setTipoManutencao(tipo)
                    setTipoEscolhido(true)
                    salvarCampos({ tipoManutencao: tipo })
                  }}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition ${
                    tipoManutencao === tipo
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {tipo}
                </button>
              ))}
            </div>
            {!tipoEscolhido && (
              <p className="mt-2 text-[11px] font-medium text-slate-600">
                Nenhum tipo escolhido — a ficha será salva como{' '}
                <strong>{ficha.tiposManutencao[0]}</strong>.
              </p>
            )}
            </>
          ) : (
            <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700">
              {ficha.tiposManutencao[0]} — única manutenção prevista para este equipamento
            </p>
          )}
        </section>
        {/* Marca única: todos os contatores da empresa são Schneider. Não é
            escolha do técnico, então virou etiqueta — um botão a menos para
            errar, e o valor entra sozinho na execução. */}
        {ficha.exigeMarca && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Marca do equipamento</h3>
            <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-800">
              {NOME_MARCA[MARCA_CONTATOR]}
            </p>
          </section>
        )}
        </>
        )}

        {topicoAtivo === 'identificacao' && (
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Dados da execução</h3>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Local *</span>
            <input
              type="text"
              value={local}
              onChange={(e) => {
                setLocal(e.target.value)
                salvarCampos({ local: e.target.value })
              }}
              placeholder="Ex.: Linha 2 — CD1"
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              {dias > 1 ? 'Início' : 'Data e hora'}
            </span>
            <input
              type="datetime-local"
              value={dataHora}
              onChange={(e) => {
                setDataHora(e.target.value)
                // mantém o encerramento coerente com o novo início
                if (dias > 1) setDataFim(somarDias(new Date(e.target.value).toISOString(), dias - 1))
              }}
              className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
            />
          </label>

          {dias > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Encerramento</span>
              <input
                type="datetime-local"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-blue-600"
              />
              <span className="mt-1.5 flex items-start gap-2 rounded-xl bg-blue-50 p-2.5 text-[11px] text-blue-900">
                <Info size={14} className="mt-0.5 shrink-0" />
                Esta manutenção dura {dias} dias e fecha uma ficha só — a identificação fica com o
                intervalo de datas.
              </span>
            </label>
          )}
        </section>
        )}

        {topicoAtivo === 'equipe' && (
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Equipe *</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                equipeCompleta ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {equipe.length}/2 pessoas
            </span>
          </div>
          <SeletorEquipe
            pessoas={pessoas}
            selecionados={equipe}
            onAlternar={selecionarPessoa}
            onRemoverRg={removerRg}
          />
          {avisoEquipe && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] font-medium text-amber-900">
              {avisoEquipe}
            </p>
          )}
          {!equipeCompleta && (
            <p className="mt-2 text-[11px] font-medium text-amber-800">
              Marque no mínimo 2 pessoas da equipe para iniciar as medições.
            </p>
          )}
        </section>
        )}

        {topicoAtivo === 'instrumentos' && (
        <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Instrumento</h3>
          </div>
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">
            <Info size={16} className="mt-0.5 shrink-0" />
            Estes campos não mudam a cada medição — o app guarda o último valor informado.
          </p>
          <div className="space-y-3">
            {camposFixosEditaveis(ficha)
              .filter((campo) => campo.tipo !== 'lista')
              .map((campo) => {
                const lembrado = patrimoniosLembrados[campo.id]
                const vazio = !(camposFixos[campo.id] ?? '').trim()
                return (
                  <label key={campo.id} className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      {campo.nome}
                    </span>
                    <input
                      type={campo.tipo === 'numero' ? 'number' : 'text'}
                      value={camposFixos[campo.id] ?? ''}
                      placeholder={lembrado ? `último: ${lembrado}` : ''}
                      onChange={(e) => {
                        const proximo = { ...camposFixos, [campo.id]: e.target.value }
                        setCamposFixos(proximo)
                        salvarCampos({ camposFixos: proximo })
                      }}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                    />
                    {/**
                     * O patrimônio da última vez aparece como sugestão, nunca
                     * já preenchido: o técnico confirma o instrumento que está
                     * usando agora, e não herda um número sem olhar.
                     */}
                    {lembrado && vazio && (
                      <button
                        type="button"
                        onClick={() => {
                          const proximo = { ...camposFixos, [campo.id]: lembrado }
                          setCamposFixos(proximo)
                          salvarCampos({ camposFixos: proximo })
                        }}
                        className="mt-1 text-[11px] font-semibold text-blue-700"
                      >
                        Usar o da última vez ({lembrado})
                      </button>
                    )}
                  </label>
                )
              })}
          </div>
        </section>
        )}

        {topicoAtivo === 'nucleo' && camposFixosEditaveis(ficha).some((campo) => campo.tipo === 'lista') && (
          <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Núcleo do contator</h3>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {ehP2
                ? 'Na P2 informe o núcleo que sai e o que entra no contator.'
                : nucleoInstalado
                  ? 'Núcleo informado na última manutenção deste contator. Só é alterado na P2.'
                  : 'Primeira manutenção deste contator: informe o núcleo instalado.'}
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Nº Série do Núcleo — Instalado
                </span>
                <select
                  value={nucleoInstalado}
                  /**
                   * Na P1 o núcleo instalado vem do cadastro do equipamento e é
                   * só leitura — menos quando não há nada registrado. Sem isso,
                   * a primeira ficha de um contator novo abria com o campo
                   * vazio e sem como preencher, travando a conclusão.
                   */
                  disabled={!ehP2 && Boolean(nucleoInstalado)}
                  onChange={(e) => {
                    setNucleoInstalado(e.target.value)
                    salvarCampos({ nucleoInstalado: e.target.value })
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="">— selecione —</option>
                  {opcoesDaLista('nucleos', nucleoInstalado).map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {opcao}
                    </option>
                  ))}
                </select>
                {!ehP2 && (
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {nucleoInstalado
                      ? 'Registrado na última manutenção · somente leitura'
                      : 'Sem núcleo registrado para este contator · informe o que está instalado'}
                  </span>
                )}
              </label>

              {ehP2 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Nº Série do Núcleo — Retirado
                  </span>
                  <select
                    value={nucleoRetirado}
                    onChange={(e) => setNucleoRetirado(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-blue-600"
                  >
                    <option value="">— selecione —</option>
                    {opcoesDaLista('nucleos', nucleoRetirado).map((opcao) => (
                      <option key={opcao} value={opcao}>
                        {opcao}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        {/**
         * Rodapé das abas: Voltar / Próximo até a última, e Concluir só nela.
         *
         * Antes havia um botão único "Iniciar medições" que pulava direto para
         * a tela de medições de qualquer aba — dava a impressão de que as abas
         * do meio eram opcionais. Agora andar é andar de aba em aba, e concluir
         * é o ato final, com conferência do que ficou em branco.
         */}
        <div className="flex gap-2">
          {indiceTopico > 0 && (
            <button
              onClick={() => onTrocarTopico(topicos[indiceTopico - 1].id)}
              className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-slate-300 px-4 py-3.5 text-sm font-semibold text-slate-700 active:bg-slate-100"
            >
              <ArrowLeft size={16} /> Voltar
            </button>
          )}
          {/*
            * Última aba editável (Instrumentos) continua dizendo "Próximo":
            * concluir é o que leva às medições. O rótulo "Concluir" ficaria
            * mentindo, porque ainda falta medir.
            */}
          {!podeConcluirAqui ? (
            <button
              onClick={() => irParaProximo()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3.5 text-sm font-semibold text-white active:bg-blue-800"
            >
              Próximo <ArrowRight size={18} />
            </button>
          ) : (
            <button
              onClick={() => void concluirComConferencia()}
              disabled={!podeContinuar}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3.5 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500 active:bg-emerald-800"
            >
              Concluir <Check size={18} />
            </button>
          )}
        </div>
        {!podeContinuar && (
          <p className="mt-2 text-center text-[11px] font-medium text-amber-800">
            {motivoPendencia}
          </p>
        )}
        {faltando.length > 0 && (
          <div className="mt-2 rounded-xl bg-amber-50 p-2.5">
            <p className="text-[11px] font-semibold text-amber-900">
              Preencha antes de concluir:
            </p>
            <ul className="mt-1 space-y-0.5">
              {faltando.map((campo) => (
                <li key={campo} className="text-[11px] font-medium text-amber-900">
                  · {campo}
                </li>
              ))}
            </ul>
          </div>
        )}</footer>
    </div>
  )
}

/**
 * RGs da equipe, na ordem rg1..rg6.
 *
 * Campos `rgN` de fichas antigas podem carregar lixo (espaço, vírgula, RG de
 * pessoa que saiu do cadastro). Aqui só passa o que tem cara de RG.
 *
 * A regra é frouxa de propósito: basta ter ao menos um dígito e não ser um
 * valor claramente quebrado. A versão anterior exigia começar com dígito
 * (`/^[0-9][0-9.\-/]*$/`), o que descartava RG com prefixo de estado —
 * `MG-12345`, `SP1234567`. Efeito colateral: a pessoa aparecia na seleção,
 * o toque era gravado, e o valor era jogado fora na releitura — o botão
 * nunca marcava e a tela não dizia por quê. Formato de RG é assunto do
 * cadastro (que avisa), não do filtro (que descarta em silêncio).
 */
/**
 * Regrava os campos rg1..rgN a partir da lista limpa, apagando as posições que
 * sobraram — é o que impede RG órfão de continuar gravado na execução.
 */
function reconstruirRgs(
  camposFixos: Record<string, string>,
  rgs: string[],
): Record<string, string> {
  const mapa: Record<string, string> = { ...camposFixos }
  for (let i = 1; i <= 6; i++) {
    const valor = rgs[i - 1]
    if (valor) mapa[`rg${i}`] = valor
    else delete mapa[`rg${i}`]
  }
  return mapa
}

/**
 * Opções de um campo tipo 'lista'. Um valor antigo já gravado que não esteja na
 * lista é preservado como primeira opção, para não perder dado de execuções
 * anteriores ao select.
 */
function opcoesDaLista(lista: 'nucleos' | undefined, valorAtual?: string): string[] {
  const base = lista === 'nucleos' ? NUCLEOS_HPB : []
  const atual = (valorAtual ?? '').trim()
  if (atual && !base.includes(atual)) return [atual, ...base]
  return base
}

/** Campos fixos que continuam editáveis (RGs saíram para o seletor de equipe). */
function camposFixosEditaveis(ficha: DefinicaoFicha) {
  return ficha.camposFixos.filter((campo) => !/^rg\d+$/.test(campo.id))
}

function paraInputLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** Mesmo horário, `n` dias depois — em ISO. */
function somarDias(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}
