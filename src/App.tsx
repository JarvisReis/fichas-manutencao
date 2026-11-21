import { useCallback, useEffect, useRef, useState } from 'react'
import { MARCA_CONTATOR, type DefinicaoFicha, type Execucao } from './types'
import { db, gerarCodigo, lerEndpointSync, limparRascunhosVencidos, limparRgOrgaoGravado, migrarChaveMarca } from './lib/db'
import { garantirTokenValido, lerToken, limparSessaoAuth } from './lib/auth'
import { montarBackup } from './lib/backup'
// O PDF só é baixado quando alguém pede: jsPDF + html2canvas ficam fora do
// bundle inicial (dynamic import).
async function baixarPdfRelatorio(args: Parameters<typeof import('./lib/pdfRelatorio')['baixarPdfRelatorio']>[0]) {
  const mod = await import('./lib/pdfRelatorio')
  return mod.baixarPdfRelatorio(args)
}
import { baixarAjustesDeFichas, baixarEquipe, baixarEquipamentos, baixarHistorico, enviarBackupAutomatico, enviarEquipamentos, enviarExecucao, publicarAjustesDeFichas, sincronizarPendentes } from './lib/sync'
import { definirFichasEmVigor, getFicha } from './config/fichas'
import { deveAplicarRemoto, fichasEmVigor, gravarAutorPublicacao, gravarFichasAjustadas, gravarVersaoAplicada, lerFichasAjustadas, lerPublicacaoPendente, lerVersaoAplicada, marcarPublicacaoPendente } from './lib/fichasEditadas'
import { chaveDoEquipamento, gravarEquipamentos, gravarPessoas, lerEquipamentos, lerPessoas, type Equipamento, type Pessoa } from './lib/cadastros'
import { identificacaoCompleta, podeEditarExecucao } from './lib/permissoes'
import { useSessao } from './lib/sessao'
import SeletorSessao from './components/SeletorSessao'
import TelaHome from './pages/TelaHome'
import TelaIdentificacao from './pages/TelaIdentificacao'
import Manual from './pages/Manual'
import TelaExecucao from './pages/TelaExecucao'
import TelaHistorico from './pages/TelaHistorico'
import TelaBackup from './pages/TelaBackup'
import TelaRecuperacao from './pages/TelaRecuperacao'
import TelaCadastros from './pages/TelaCadastros'
import { TelaSenha } from './pages/TelaSenha'
import { TelaConvite } from './pages/TelaConvite'
import { useTema } from './lib/tema'
import { topicosDaFicha, type Topico } from './lib/topicosFicha'

type Rota =
  | { nome: 'home' }
  | { nome: 'identificacao'; ficha: DefinicaoFicha; execucao: Execucao }
  | { nome: 'execucao'; ficha: DefinicaoFicha; execucao: Execucao }
  | { nome: 'historico' }
  | { nome: 'backup' }
  | { nome: 'manual' }
  | { nome: 'recuperacao' }
  /** `aba` abre os cadastros já na seção pedida (ex.: editor de ficha). */
  | { nome: 'cadastros'; aba?: 'equipe' | 'equipamentos' | 'fichas' }
  | { nome: 'senha' }
  | { nome: 'ficha'; ficha: DefinicaoFicha; execucao: Execucao; equipamento: Equipamento | null }
  | { nome: 'salvo'; execucao: Execucao; equipamento: Equipamento | null }
  // Rota lida da URL que ainda precisa do banco para abrir (carrega o id).
  | { nome: 'home'; pendente?: { nome: string; id: string } }

/**
 * Grava a tela na URL, para recarregar ou reabrir o app na mesma tela.
 *
 * Duas camadas:
 *  - telas que não dependem de dados (`#/historico`, `#/backup`, ...)
 *  - telas que abrem uma execução, que carregam o id: `#/execucao/<id>`,
 *    `#/ficha/<id>`, `#/identificacao/<id>`
 *
 * Sem o id na URL, recarregar no meio de uma ficha jogava o técnico de volta
 * para a home e ele tinha que achar o equipamento outra vez — o pior momento
 * possível, porque a ficha estava pela metade.
 */
const ROTAS_NA_URL = new Set(['historico', 'backup', 'recuperacao', 'cadastros', 'manual'])
const ROTAS_COM_ID = new Set(['identificacao', 'execucao', 'ficha'])

/** Hash da rota, ou '' para a home. */
function hashDaRota(rota: Rota): string {
  if (ROTAS_NA_URL.has(rota.nome)) return `#/${rota.nome}`
  if (ROTAS_COM_ID.has(rota.nome) && 'execucao' in rota) {
    return `#/${rota.nome}/${encodeURIComponent(rota.execucao.id)}`
  }
  return ''
}

function rotaDaUrl(): Rota {
  // `#/execucao/<id>` — o id pode conter caractere escapado, então separa no
  // primeiro '/' depois do nome e decodifica o resto como id inteiro.
  const alvo = window.location.hash.replace(/^#\/?/, '')
  const barra = alvo.indexOf('/')
  const nome = barra === -1 ? alvo : alvo.slice(0, barra)
  const id = barra === -1 ? '' : alvo.slice(barra + 1)
  if (ROTAS_NA_URL.has(nome)) return { nome } as Rota
  // Rota com id é resolvida depois, quando o banco estiver disponível.
  if (ROTAS_COM_ID.has(nome) && id) {
    return { nome: 'home', pendente: { nome, id: decodeURIComponent(id) } } as Rota
  }
  return { nome: 'home' }
}

/**
 * O Supabase manda o convidado para cá com um token na URL. Sem essa checagem
 * ele caía na home e não conseguia criar a senha.
 */
function temConviteNaUrl(): boolean {
  const t = `${window.location.hash}${window.location.search}`
  return /access_token=|type=invite|[?&]token=/.test(t) || erroDeConviteNaUrl()
}

/**
 * O Supabase devolve o erro do link no hash: `#error=access_denied&
 * error_code=otp_expired`. Antes isso não era reconhecido como convite, então
 * o app abria normalmente — **na sessão que já estava salva no aparelho**. O
 * convidado clicava no link vencido e caía na conta do administrador, sem
 * nenhum aviso de que o convite tinha expirado.
 */
function erroDeConviteNaUrl(): boolean {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const params = new URLSearchParams(hash)
  const busca = new URLSearchParams(window.location.search)
  const codigo = params.get('error_code') ?? busca.get('error_code')
  return Boolean(params.get('error') ?? busca.get('error')) || Boolean(codigo)
}

export default function App() {
  const [rota, setRotaState] = useState<Rota>(rotaDaUrl)
  const [aceitandoConvite, setAceitandoConvite] = useState(temConviteNaUrl)
  /** Aba escolhida na identificação. A tela de medições guarda a sua. */
  const [topicoIdentificacao, setTopicoIdentificacao] = useState<Topico | null>(null)

  /** Troca de tela mantendo a URL em sincronia com o que está aberto. */
  const setRota: typeof setRotaState = (valor) => {
    setRotaState((atual) => {
      const proxima = typeof valor === 'function' ? valor(atual) : valor
      const hash = hashDaRota(proxima)
      if (window.location.hash !== hash) {
        const url = `${window.location.pathname}${window.location.search}${hash}`
        window.history.replaceState(null, '', url)
      }
      return proxima
    })
  }

  const [online, setOnline] = useState(navigator.onLine)
  const { tema, alternar } = useTema()
  const { sessao, entrar, sair: sairSessao, ehAdministrador } = useSessao()

  /**
   * Encerra a sessão no aparelho.
   *
   * NÃO fecha a janela. Fechar fazia sentido quando este era só o botão
   * "Sair"; hoje a mesma função é usada por verificações automáticas, e
   * `window.close()` num celular derrubava o app do nada — foi o que
   * acontecia ao entrar, porque a checagem não encontrava o usuário na
   * lista local e concluía "sessão inválida".
   *
   * Sair agora só limpa a sessão e volta para a home; quem quiser fechar,
   * fecha.
   */
  const sair = useCallback(() => {
    sairSessao()
    setRotaState({ nome: 'home' })
  }, [sairSessao])

  /**
   * Recado para a home quando a tela pedida não pôde ser aberta.
   *
   * Antes a queda para a home era muda: o técnico tocava no equipamento, caía
   * na lista e achava que tinha errado o toque. Agora o app diz o que houve.
   */
  const [aviso, setAviso] = useState<string | null>(null)

  // Quantas pessoas existem no cadastro. Com zero, o administrador ainda não
  // existe e o app precisa abrir a tela de cadastros — senão nasce trancado.
  const [identificando, setIdentificando] = useState(false)
  const [totalPessoas, setTotalPessoas] = useState<number | null>(null)
  useEffect(() => {
    const contar = () => void lerPessoas().then((l) => setTotalPessoas(l.length))
    contar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') contar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [rota])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const atualizarExecucao = useCallback(
    (id: string, patch: Partial<Execucao>) => {
      setRota((atual) => {
        if ((atual.nome === 'identificacao' || atual.nome === 'execucao') && atual.execucao.id === id) {
          const atualizada = { ...atual.execucao, ...patch, atualizadaEm: new Date().toISOString() }
          void db.execucoes.put(atualizada)
          return { ...atual, execucao: atualizada } as Rota
        }
        return atual
      })
    },
    [],
  )

  /**
   * Revalida a sessão contra o cadastro.
   *
   * A pessoa agora vem do Supabase (`auth.users` + `perfis`), e o
   * `pessoaId` é o UUID do Auth — que NÃO está na lista local de funcionários.
   * Procurar por ele em `lerPessoas()` dava sempre "não encontrado" e a sessão
   * caía logo depois do login.
   *
   * Quem valida de verdade é o Supabase: sem token, a pessoa já não entra; e
   * desativada no `perfis`, o servidor recusa as chamadas. Aqui só checamos o
   * cadastro local quando o id realmente pertence a ele — o caso de sessão
   * criada antes desta mudança.
   */
  const validarSessao = useCallback(async () => {
    if (!sessao) return
    const pessoas = await lerPessoas()
    const pessoa = pessoas.find((p) => p.id === sessao.pessoaId)
    // Id que não é do cadastro local = usuário do Supabase; nada a validar aqui.
    if (!pessoa) return
    if (!pessoa.ativo || pessoa.nivel !== sessao.nivel) sair()
  }, [sessao, sair])

  useEffect(() => {
    void validarSessao()
  }, [validarSessao])

  /**
   * Ao entrar, puxa a equipe do servidor e envia o que ficou na fila.
   *
   * A lista de técnicos precisa ser a mesma em todo aparelho — antes ela só
   * existia na memória local de quem cadastrou, e os outros viam a equipe
   * vazia. E as medições ficavam paradas esperando alguém abrir a tela de
   * Backup e apertar "sincronizar"; agora sobem sozinhas quando há rede.
   */
  useEffect(() => {
    /**
     * Sincroniza sempre que há login — não só quando o técnico "se identificou"
     * no topo da home. Antes a fila esperava alguém escolher a pessoa ativa, e
     * ficha preenchida ficava parada sem nenhum aviso para quem não tinha feito
     * essa escolha.
     */
    if (!lerToken()) return
    let cancelado = false

    /**
     * Fichas em vigor — limite de medição, itens, nomes.
     *
     * A ordem é: publica o que este aparelho tem pendente, depois baixa. Ao
     * contrário, a alteração feita sem rede pelo administrador seria apagada
     * pelo que está no servidor no instante em que ele voltasse a ter sinal.
     *
     * Se a publicação pendente falhar, o download é cancelado de propósito: é
     * melhor a equipe ficar na versão antiga por mais um tempo do que perder a
     * revisão de limite que ninguém conseguiu enviar.
     */
    const sincronizarAjustesDeFichas = async (base: string) => {
      const pendente = await lerPublicacaoPendente().catch(() => false)
      if (pendente) {
        if (!ehAdministrador) {
          await marcarPublicacaoPendente(false).catch(() => undefined)
        } else {
          const ajustes = await lerFichasAjustadas().catch(() => ({}))
          const envio = await publicarAjustesDeFichas(base, ajustes)
          if (!envio.ok) return
          await marcarPublicacaoPendente(false).catch(() => undefined)
          if (envio.atualizadoEm) {
            await gravarVersaoAplicada(envio.atualizadoEm).catch(() => undefined)
          }
        }
      }

      const baixados = await baixarAjustesDeFichas(base)
      if (!baixados.ok || !baixados.dados) return

      const aplicada = await lerVersaoAplicada().catch(() => null)
      if (!deveAplicarRemoto(aplicada, baixados.dados.atualizadoEm)) return

      await gravarFichasAjustadas(baixados.dados.ajustes)
      if (baixados.dados.atualizadoEm) {
        await gravarVersaoAplicada(baixados.dados.atualizadoEm).catch(() => undefined)
      }
      await gravarAutorPublicacao(baixados.dados.autor ?? null).catch(() => undefined)
      // A tela de execução já acha a ficha nova sem recarregar.
      definirFichasEmVigor(fichasEmVigor(baixados.dados.ajustes))
    }

    const sincronizar = async () => {
      const base = lerEndpointSync()
      if (!base) return
      /**
       * Token de acesso do Supabase vence em 1 hora.
       *
       * Sem renovar aqui, o app continuava "logado" com um token vencido e toda
       * sincronização morria em 401 sem avisar: o técnico só via dado novo
       * depois de sair da conta e entrar de novo. Atualizar a página não
       * resolvia porque o token vencido continuava no aparelho.
       */
      const sessaoValida = await garantirTokenValido()
      if (cancelado) return
      if (!sessaoValida) {
        // Renovação recusada (refresh vencido, conta desativada): não adianta
        // insistir. Manda entrar de novo, em vez de falhar calado.
        if (!lerToken() && sessao) sair()
        return
      }
      const equipe = await baixarEquipe(base)
      if (cancelado) return
      // Só substitui a lista quando o servidor realmente devolve gente: lista
      // vazia costuma ser tabela ainda não migrada, e apagar a equipe local
      // deixaria o técnico sem conseguir montar dupla em campo.
      if (equipe.ok && Array.isArray(equipe.pessoas) && equipe.pessoas.length > 0) {
        await gravarPessoas(equipe.pessoas as Pessoa[])
      }
      if (!navigator.onLine) return
      await sincronizarPendentes(`${base.replace(/\/$/, '')}/fichas`)
      if (cancelado) return
      /**
       * BAIXAR ANTES DE ENVIAR — a ordem aqui é a regra, não um detalhe.
       *
       * Era o contrário: o administrador publicava a lista local primeiro e só
       * depois baixava a do servidor. Um aparelho com cópia antiga (duplicata,
       * equipamento já apagado, marca errada) reimprimia tudo por cima do
       * servidor a cada abertura, e a correção feita lá era desfeita sozinha.
       *
       * Agora o servidor é a verdade: todo aparelho recebe primeiro. Depois, o
       * administrador publica apenas o que ele realmente tem e o servidor
       * ainda não conhece — comparação por nome, que é a identidade do
       * equipamento. O que existe lá não é reenviado, então nada velho
       * sobrescreve o que está certo.
       */
      const baixados = await baixarEquipamentos(base)
      if (cancelado) return
      // Lista vazia do servidor vale como resposta: é assim que o equipamento
      // apagado lá some daqui.
      const doServidor =
        baixados.ok && Array.isArray(baixados.equipamentos)
          ? (baixados.equipamentos as Equipamento[])
          : null
      if (doServidor) {
        await gravarEquipamentos(doServidor)
      }
      if (ehAdministrador && doServidor) {
        // Só o que é novo: equipamento que o servidor já tem não é republicado
        // com a versão local (que pode ser a cópia velha).
        const nomesNoServidor = new Set(
          doServidor.map((e) => chaveDoEquipamento(e)).filter(Boolean),
        )
        const locais = await lerEquipamentos()
        const novos = locais.filter((e) => !nomesNoServidor.has(chaveDoEquipamento(e)))
        if (novos.length > 0) await enviarEquipamentos(base, novos as unknown[])
        if (cancelado) return
      }
      /**
       * Fichas antes do histórico: a ficha em vigor decide como o resultado é
       * avaliado, então precisa estar atualizada quando as execuções descem.
       */
      await sincronizarAjustesDeFichas(base)
      if (cancelado) return
      // Depois de subir a fila, traz o que os outros aparelhos gravaram: sem
      // isso a home deste computador ficava sem recentes e sem histórico.
      await baixarHistorico(base)
      /**
       * Cópia de segurança no servidor, ao fim de cada sincronização.
       *
       * É a rede de proteção que faltava: o dado mora neste navegador e
       * "limpar cache" apaga tudo. Uma ficha de homologação se perdeu assim —
       * nunca subiu, existia só aqui, e o cache foi limpo.
       *
       * Roda depois do envio e depois do download, então o pacote já contém o
       * que o técnico preencheu E o que veio do servidor. Falha em silêncio:
       * backup é seguro, não é tarefa que o técnico precise resolver.
       */
      if (!cancelado) {
        try {
          const pacote = await montarBackup()
          await enviarBackupAutomatico(base, pacote)
        } catch {
          // sem rede, sem espaço ou servidor fora: a próxima sincronização tenta de novo
        }
      }
      // A home já tinha lido a lista antes deste download terminar. O aviso a
      // faz reler — sem ele o aparelho novo só mostrava dados ao recarregar.
      if (!cancelado) window.dispatchEvent(new Event('fichas:sincronizado'))
    }
    void sincronizar()
    // volta a rede: tenta de novo, sem esperar o técnico fazer nada
    window.addEventListener('online', sincronizar)
    // fecha e reabre o app: nova tentativa, senão a fila só anda em recarregar
    document.addEventListener('visibilitychange', sincronizar)
    return () => {
      cancelado = true
      window.removeEventListener('online', sincronizar)
      document.removeEventListener('visibilitychange', sincronizar)
    }
  }, [sessao, ehAdministrador, sair])

  /**
   * Abre uma execução a partir do contator escolhido: a ficha e o local vêm do
   * cadastro do equipamento, não de uma escolha manual.
   */
  const novaExecucaoDoEquipamento = async (equipamento: Equipamento) => {
    const ficha = getFicha(equipamento.fichaId)
    if (!ficha) return
    const existentes = await db.execucoes.toArray()
    const agora = new Date()
    const execucao: Execucao = {
      id: crypto.randomUUID(),
      codigo: gerarCodigo(equipamento.nome, agora, existentes),
      fichaId: ficha.id,
      cabecalho: {},
      camposFixos: { equipamento: equipamento.nome },
      local: equipamento.local ?? '',
      // Marca não é escolha: todo contator é Schneider. Grava na criação para
      // a conformidade já ler o limite certo sem passar pela identificação.
      ...(ficha.exigeMarca ? { marca: MARCA_CONTATOR } : {}),
      dataHora: agora.toISOString(),
      valores: ficha.itens.map((item) => ({ itemId: item.id, valor: '' })),
      status: 'rascunho',
      criadaPor: sessao?.pessoaId,
      sincronizada: false,
      criadaEm: agora.toISOString(),
      atualizadaEm: agora.toISOString(),
    }
    await db.execucoes.put(execucao)
    setRota({ nome: 'identificacao', ficha, execucao })
  }

  /**
   * Toque no equipamento da home: abre a ÚLTIMA manutenção dele, não uma ficha
   * em branco. É o que o técnico quer ver — o que foi feito e quando. A ficha
   * nova só nasce pelo botão "Nova manutenção" dessa tela.
   */
  const abrirUltimaManutencao = async (equipamento: Equipamento) => {
    const nome = equipamento.nome.trim()
    const todas = await db.execucoes.toArray()
    const doEquipamento = todas
      .filter((e) => (e.camposFixos.equipamento ?? '').trim() === nome)
      .sort((a, b) => Date.parse(b.dataHora) - Date.parse(a.dataHora))

    if (doEquipamento.length === 0) {
      await novaExecucaoDoEquipamento(equipamento)
      return
    }

    const ultima = doEquipamento[0]
    const ficha = getFicha(ultima.fichaId)
    if (!ficha) {
      setAviso(
        `A ficha da última manutenção de ${nome} não existe mais neste aparelho. Atualize o app ou abra uma manutenção nova.`,
      )
      return
    }

    // Rascunho abre para edição (é trabalho em andamento); concluída abre em
    // leitura, com o botão de nova manutenção no rodapé.
    if (ultima.status === 'rascunho') {
      if (!podeEditarExecucao(ultima, sessao, ultima.criadaPor).pode) {
        await novaExecucaoDoEquipamento(equipamento)
        return
      }
      // Rascunho com identificação pela metade volta para a identificação: as
      // medições só abrem com local, tipo e equipe completos.
      if (!identificacaoCompleta(ultima, { exigeMarca: ficha.exigeMarca })) {
        setRota({ nome: 'identificacao', ficha, execucao: ultima })
        return
      }
      setRota({ nome: 'execucao', ficha, execucao: ultima })
      return
    }

    setRota({ nome: 'ficha', ficha, execucao: ultima, equipamento })
  }

  /**
   * Abre a execução para edição. Rascunho é de quem executa; ficha concluída é
   * registro fechado — só administrador reabre (e o histórico avisa antes).
   */
  const abrirExecucao = async (id: string) => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) {
      setAviso('Esta execução não está mais neste aparelho.')
      return
    }
    if (!podeEditarExecucao(execucao, sessao, execucao.criadaPor).pode) return
    const ficha = getFicha(execucao.fichaId)
    if (!ficha) {
      setAviso('A ficha desta execução não existe mais neste aparelho. Atualize o app.')
      return
    }
    // Mesma trava do toque no equipamento: rascunho incompleto não entra em
    // medições por nenhum caminho.
    if (!identificacaoCompleta(execucao, { exigeMarca: ficha.exigeMarca })) {
      setRota({ nome: 'identificacao', ficha, execucao })
      return
    }
    /**
     * Ficha fechada reabre na tela de identificação.
     *
     * "Reabrir e corrigir" existe para revisar identificação, equipe e
     * instrumentos — e é na tela de identificação que esses campos se editam.
     * Abrir na ficha (nas medições) fazia o revisor começar pelo fim e ainda
     * mostrava os blocos só para leitura. Rascunho continua abrindo na ficha,
     * nas medições, que é onde o técnico parou.
     */
    if (execucao.status !== 'rascunho') {
      setTopicoIdentificacao(null)
      setRota({ nome: 'identificacao', ficha, execucao })
      return
    }
    setRota({ nome: 'execucao', ficha, execucao })
  }

  /** Equipamento cadastrado correspondente ao nome gravado na execução. */
  const equipamentoDaExecucao = async (execucao: Execucao): Promise<Equipamento | null> => {
    const nome = (execucao.camposFixos.equipamento ?? '').trim()
    const lista = await lerEquipamentos()
    const achado = lista.find((e) => e.nome.trim() === nome)
    if (achado) return achado
    // equipamento digitado à mão (não cadastrado): reaproveita a ficha e o local
    const ficha = getFicha(execucao.fichaId)
    if (!ficha || !nome) return null
    return {
      id: `avulso:${nome}`,
      nome,
      local: execucao.local,
      fichaId: ficha.id,
    } as Equipamento
  }

  /** Equipamento mínimo a partir da própria execução, quando nada mais resolve. */
  const equipamentoAvulso = (execucao: Execucao): Equipamento => {
    const ficha = getFicha(execucao.fichaId)
    const nome = (execucao.camposFixos.equipamento ?? '').trim() || 'Equipamento sem nome'
    return {
      id: `avulso:${nome}`,
      nome,
      local: execucao.local ?? '',
      fichaId: ficha?.id ?? execucao.fichaId,
    } as Equipamento
  }

  /**
   * Aplica a rota que está na URL: recarregar ou voltar restaura a mesma tela.
   *
   * A URL só guarda o id, então é preciso reler a execução e a ficha para
   * remontar a rota. Se a execução sumiu (apagada em outro aparelho) ou a
   * sessão não permite editar, cai na home sem barulho — restaurar não pode
   * virar um erro na cara do técnico.
   */
  const aplicarRotaDaUrl = useCallback(async () => {
    /**
     * Convite na URL manda mais que qualquer rota. Sem esta saída, o efeito de
     * restauração chamava `setRotaState(rotaDaUrl())` logo na montagem e
     * atropelava a tela do convite — a pessoa caía na home (ou na sessão
     * anterior, quando o link estava vencido) sem nunca ver "criar senha".
     */
    if (aceitandoConvite) return
    const daUrl = rotaDaUrl()
    const pendente = (daUrl as { pendente?: { nome: string; id: string } }).pendente
    if (!pendente) {
      setRotaState(daUrl)
      return
    }
    const execucao = await db.execucoes.get(pendente.id)
    if (!execucao) {
      setAviso('Esta execução não está mais neste aparelho — pode ter sido apagada ou sincronizada em outro.')
      setRotaState({ nome: 'home' })
      return
    }
    const ficha = getFicha(execucao.fichaId)
    if (!ficha) {
      // Ficha do modelo sumiu do app (versão desatualizada ou id órfão): sem
      // ela não há o que medir, e o registro precisa ser reaberto pelo admin.
      setAviso(
        'A ficha desta execução não existe mais neste aparelho. Atualize o app; se continuar, peça ao administrador para reabrir o registro.',
      )
      setRotaState({ nome: 'home' })
      return
    }
    if (pendente.nome === 'ficha') {
      const equipamento = await equipamentoDaExecucao(execucao)
      setRotaState({ nome: 'ficha', ficha, execucao, equipamento })
      return
    }
    if (!podeEditarExecucao(execucao, sessao, execucao.criadaPor).pode) {
      setRotaState({ nome: 'home' })
      return
    }
    // Recarregar a página com medições abertas não fura a regra: se a
    // identificação está incompleta, volta para ela.
    const completa = identificacaoCompleta(execucao, { exigeMarca: ficha.exigeMarca })
    const destino = completa ? (pendente.nome as 'identificacao' | 'execucao') : 'identificacao'
    // Com `setRota` a URL acompanha: se a identificação barrou a entrada em
    // medições, o endereço passa a dizer `identificacao`, senão recarregar de
    // novo repetiria a correção e a URL ficaria mentindo.
    setRota({ nome: destino, ficha, execucao })
  }, [sessao, aceitandoConvite])

  // Na abertura, depois da limpeza: a URL é a fonte da verdade.
  const restauracaoFeita = useRef(false)
  useEffect(() => {
    if (restauracaoFeita.current) return
    restauracaoFeita.current = true
    void (async () => {
      // Só depois da limpeza: um rascunho vencido não deve reabrir.
      // A marca vem antes de tudo: sem a chave atual, o limite lido é o errado.
      await migrarChaveMarca().catch(() => {})
      await limparRgOrgaoGravado().catch(() => {})
      await limparRascunhosVencidos().catch(() => {})
      /**
       * As fichas em vigor precisam estar prontas ANTES de qualquer tela.
       *
       * `getFicha` é síncrono e chamado na renderização; se o ajuste do
       * administrador chegasse depois, a primeira ficha aberta sairia com a
       * definição padrão e os limites antigos.
       */
      definirFichasEmVigor(fichasEmVigor(await lerFichasAjustadas().catch(() => ({}))))
      await aplicarRotaDaUrl()
    })()
  }, [aplicarRotaDaUrl])

  // Botão voltar do navegador/aparelho e mudança de hash: a URL manda na tela.
  useEffect(() => {
    const aoMudarHash = () => aplicarRotaDaUrl()
    window.addEventListener('hashchange', aoMudarHash)
    return () => window.removeEventListener('hashchange', aoMudarHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handler estável por render
  }, [sessao])

  const salvarExecucao = async (id: string, status: Execucao['status']) => {
    const execucao = await db.execucoes.get(id)
    if (!execucao) return
    const atualizada: Execucao = { ...execucao, status, atualizadaEm: new Date().toISOString() }
    await db.execucoes.put(atualizada)
    /**
     * Concluir envia na hora, não no próximo login.
     *
     * Antes só se gravava no aparelho e a tela dizia "Execução concluída". Se o
     * técnico fechasse o app, a ficha ficava só ali: nunca subia, e nenhum
     * outro aparelho a recebia. Falha de rede não bloqueia nada — a ficha
     * continua na fila e sobe na próxima sincronização.
     */
    if (status !== 'rascunho') {
      const base = lerEndpointSync()
      if (base) {
        const r = await enviarExecucao(id, `${base.replace(/\/$/, '')}/fichas`)
        if (!r.ok) console.warn('ficha concluída não subiu, segue na fila:', r.erro)
      }
      // Equipamento sempre resolvido: mesmo digitado à mão vira um "avulso", para
      // a tela de sucesso conseguir oferecer a próxima manutenção.
      const equipamento =
        (await equipamentoDaExecucao(atualizada)) ?? equipamentoAvulso(atualizada)
      setRota({ nome: 'salvo', execucao: atualizada, equipamento })
    } else {
      setRota({ nome: 'home' })
    }
  }

  // Convite tem prioridade sobre qualquer rota: a pessoa ainda não tem senha.
  if (aceitandoConvite) {
    return (
      <TelaConvite
        onPronto={() => {
          setAceitandoConvite(false)
          setRota({ nome: 'home' })
        }}
        // Convite vencido + "entrar com minha senha": encerra a sessão que
        // estiver salva no aparelho. Sem isto o convidado caía direto na conta
        // de quem já estava logado (o admin, no celular da equipe).
        onSairParaLogin={() => {
          limparSessaoAuth()
          sairSessao()
          setAceitandoConvite(false)
          setRota({ nome: 'home' })
        }}
      />
    )
  }

  switch (rota.nome) {
    case 'identificacao':
      return (
        <TelaIdentificacao
          ficha={rota.ficha}
          execucao={rota.execucao}
          onVoltar={() => setRota({ nome: 'home' })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onContinuar={() => setRota({ nome: 'execucao', ficha: rota.ficha, execucao: rota.execucao })}
          topicos={topicosDaFicha({ ficha: rota.ficha })}
          topico={topicoIdentificacao}
          onTrocarTopico={setTopicoIdentificacao}
        />
      )

    case 'execucao':
      return (
        <TelaExecucao
          ficha={rota.ficha}
          execucao={rota.execucao}
          podeAlterar={podeEditarExecucao(rota.execucao, sessao, rota.execucao.criadaPor).pode}
          onVoltar={() => {
            // Voltar das medições cai na identificação, não na última aba usada.
            setTopicoIdentificacao(null)
            setRota({ nome: 'identificacao', ficha: rota.ficha, execucao: rota.execucao })
          }}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onIrParaTopico={(topico) => {
            /**
             * Bloco que não vive nas medições abre na identificação, já na aba
             * certa. Sem isto a aba só trocava o tópico local e a tela ficava
             * branca — não havia bloco para desenhar.
             */
            setTopicoIdentificacao(topico)
            setRota({ nome: 'identificacao', ficha: rota.ficha, execucao: rota.execucao })
          }}
          onSalvar={(status) => void salvarExecucao(rota.execucao.id, status)}
        />
      )

    case 'historico':
      return (
        <TelaHistorico
          podeExcluir={ehAdministrador}
          sessao={sessao}
          onVoltar={() => setRota({ nome: 'home' })}
          onAbrir={(id) => void abrirExecucao(id)}
        />
      )

    case 'cadastros': {
      // Sem sessão de administrador a tela não abre — nem por rota antiga.
      // Exceção: aparelho sem nenhuma pessoa cadastrada. Aí o administrador
      // ainda não existe e, sem esta saída, o app nasce trancado.
      const semNinguem = !ehAdministrador && totalPessoas === 0
      if (!ehAdministrador && !semNinguem) {
        return (
          <TelaHome
            online={online}
            temaEscuro={tema === 'escuro'}
            sessao={sessao}
            ehAdministrador={ehAdministrador}
            onEntrar={() => setIdentificando(true)}
            onSair={sair}
            onNovaExecucaoDoEquipamento={(equip) => void abrirUltimaManutencao(equip)}
            onAbrirExecucao={(id) => void abrirExecucao(id)}
            onVerHistorico={() => setRota({ nome: 'historico' })}
            onVerBackup={() => setRota({ nome: 'backup' })}
            onVerManual={() => setRota({ nome: 'manual' })}
            onVerCadastros={() => setRota({ nome: 'cadastros' })}
            onTrocarSenha={() => setRota({ nome: 'senha' })}
            onAlternarTema={alternar}
          />
        )
      }
      return (
        <TelaCadastros
          administrador={ehAdministrador ? (sessao?.nome ?? '') : undefined}
          abaInicial={rota.aba}
          onVoltar={() => setRota({ nome: 'home' })}
        />
      )
    }

    case 'senha':
      return <TelaSenha onVoltar={() => setRota({ nome: 'home' })} />

    case 'manual':
      return <Manual onVoltar={() => setRota({ nome: 'home' })} />

    case 'backup':
      return (
        <TelaBackup
          ehAdministrador={ehAdministrador}
          onVoltar={() => setRota({ nome: 'home' })}
          onRestaurado={() => setRota({ nome: 'home' })}
          onAbrirRecuperacao={() => setRota({ nome: 'recuperacao' })}
        />
      )

    case 'recuperacao':
      return (
        <TelaRecuperacao
          ehAdministrador={ehAdministrador}
          onVoltar={() => setRota({ nome: 'backup' })}
          onRestaurado={() => window.dispatchEvent(new Event('fichas:sincronizado'))}
        />
      )

    case 'ficha':
      if (!rota.equipamento) {
        return (
          <TelaHistorico
            podeExcluir={ehAdministrador}
            sessao={sessao}
            onVoltar={() => setRota({ nome: 'home' })}
            onAbrir={(id) => void abrirExecucao(id)}
          />
        )
      }
      return (
        <TelaExecucao
          ficha={rota.ficha}
          execucao={rota.execucao}
          podeAlterar={false}
          onVoltar={() => setRota({ nome: 'historico' })}
          onAtualizar={(patch) => atualizarExecucao(rota.execucao.id, patch)}
          onSalvar={() => undefined}
          onNovaManutencao={
            rota.equipamento ? () => void novaExecucaoDoEquipamento(rota.equipamento!) : undefined
          }
          /** Atalho de administrador: abrir a aba de edição direto da ficha. */
          
        />
      )

    case 'salvo':
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
              rota.execucao.status === 'pendente'
                ? 'bg-red-100 text-red-700'
                : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {rota.execucao.status === 'pendente' ? '!' : '✓'}
          </div>
          <h1
            className={`text-lg font-bold ${
              rota.execucao.status === 'pendente' ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {rota.execucao.status === 'pendente'
              ? 'Salva como pendente'
              : 'Execução concluída'}
          </h1>
          <p className="max-w-xs text-sm text-slate-600">
            {rota.execucao.status === 'pendente'
              ? `${rota.execucao.codigo} foi salva e está marcada como pendente: há medição fora do limite.`
              : `${rota.execucao.codigo} foi salva no aparelho e ficará na fila até sincronizar com o servidor.`}
          </p>
          <button
            onClick={() => setRota({ nome: 'home' })}
            className="w-full max-w-xs rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Voltar ao início
          </button>
          <button
            onClick={() => setRota({ nome: 'historico' })}
            className="w-full max-w-xs rounded-xl py-3 text-sm font-semibold text-blue-700"
          >
            Ver histórico
          </button>
          {/* O técnico acabou de concluir: o PDF sai daqui, sem caçar a ficha
              no histórico. Em campo é o documento que ele entrega. */}
          <button
            onClick={() => {
              const ficha = getFicha(rota.execucao.fichaId)
              if (!ficha) return
              void lerPessoas().then((pessoas) => {
                const nomes: Record<string, string> = {}
                for (const p of pessoas) nomes[p.rg.trim()] = p.nome
                void baixarPdfRelatorio({ ficha, execucao: rota.execucao, nomes })
              })
            }}
            className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Baixar relatório em PDF
          </button>
        </div>
      )

    default:
      return (
        <>
          {identificando && !sessao && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
              <div className="w-full max-w-sm space-y-2 rounded-2xl bg-white p-4 shadow-2xl">
                <SeletorSessao
                  sessao={sessao}
                  ehAdministrador={ehAdministrador}
                  onEntrar={(nova) => {
                    entrar(nova)
                    setIdentificando(false)
                  }}
                  onSair={() => setIdentificando(false)}
                />
                <button
                  onClick={() => setIdentificando(false)}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-600"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <TelaHome
          aviso={aviso}
          onFecharAviso={() => setAviso(null)}
          online={online}
          sessao={sessao}
          onEntrar={() => setIdentificando(true)}
          onSair={sair}
          ehAdministrador={ehAdministrador}
          onNovaExecucaoDoEquipamento={(equip) => void abrirUltimaManutencao(equip)}
          onAbrirExecucao={(id) => void abrirExecucao(id)}
          onVerHistorico={() => setRota({ nome: 'historico' })}
          onVerBackup={() => setRota({ nome: 'backup' })}
          onVerManual={() => setRota({ nome: 'manual' })}
          onVerCadastros={() => setRota({ nome: 'cadastros' })}
          onTrocarSenha={() => setRota({ nome: 'senha' })}
          onAlternarTema={alternar}
          temaEscuro={tema === 'escuro'}
          />
        </>
      )
  }
}
