import { jsPDF } from 'jspdf'
import { NOME_MARCA, type DefinicaoFicha, type Execucao, type ItemFicha } from '../types'
import { avaliarItem, parseValor } from './conformidade'

/**
 * Relatório da ficha em PDF, para arquivar/entregar.
 *
 * A tela de execução é dividida em tópicos porque em campo o técnico preenche
 * um bloco por vez. O relatório é o contrário: é documento, tem que sair
 * inteiro numa leitura só. Por isso o PDF é montado aqui, com a mesma
 * sequência da ficha de papel — identificação, equipe, instrumentos, medições
 * e observação.
 */

interface Entrada {
  ficha: DefinicaoFicha
  execucao: Execucao
  /** RG → nome, para o relatório mostrar quem assinou */
  nomes: Record<string, string>
}

const INSTRUMENTOS: [string, string][] = [
  ['microPatrimonio', 'Microohmímetro'],
  ['megaPatrimonio', 'Megômetro'],
  ['torqPatrimonio', 'Torquímetro'],
]

// ---- Marca d'água
//
// A folha é sempre A4 retrato, então as medidas são constantes em vez de vir do
// documento: deixam a conta da diagonal legível.
const LARGURA_A4 = 210
const ALTURA_A4 = 297
/** Corpo em que o texto é medido; o tamanho final sai por proporção. */
const CORPO_REFERENCIA = 10
/**
 * Teto de corpo da marca.
 *
 * Precisa ser alto: para cobrir 75% da diagonal com um código curto o corpo
 * passa de 190 pt. Com teto de 120 a marca parava em 231 mm em vez dos 273
 * pedidos, e era o teto — não a conta — que mandava no tamanho.
 */
const CORPO_MAXIMO_MARCA = 400
/**
 * Correção entre o comprimento que `getTextWidth` promete e o que sai no papel.
 *
 * Medido no PDF gerado: pedindo 75% da diagonal sai 91,4% dela. O jsPDF não
 * conta a caixa dos glifos quando o texto é girado, então o alvo precisa encolher
 * nesse tanto para a marca terminar exatamente nos 75%.
 */
const FATOR_DESENHO_MARCA = 0.8591
/** Resíduo de posição do jsPDF, medido no PDF gerado (ver comentário no uso). */
const AJUSTE_CENTRO_X = 12.9
const AJUSTE_CENTRO_Y = 9.2

/**
 * Corpo da fonte que faz o texto ocupar `comprimentoAlvo` milímetros.
 *
 * Mede o texto num corpo conhecido e aplica regra de três. Serve para qualquer
 * texto: o mesmo cálculo dá o tamanho certo tanto para "CLI-CT01" quanto para
 * um código comprido.
 *
 * Exportada porque a conta é fácil de errar de cabeça e vale testar.
 */
export function corpoParaComprimento(
  larguraEmReferencia: number,
  comprimentoAlvo: number,
): number {
  if (larguraEmReferencia <= 0) return CORPO_REFERENCIA
  const corpo = (CORPO_REFERENCIA * comprimentoAlvo) / larguraEmReferencia
  return Math.min(corpo, CORPO_MAXIMO_MARCA)
}

/**
 * Recuo da ponta inicial do texto para o **meio** dele cair num ponto dado.
 *
 * O texto é girado 45° subindo para a direita, então a ponta fica abaixo e à
 * esquerda do centro: recua `comprimento/2 × cos45°` em x e desce o mesmo tanto
 * em y. Confirmado medindo o PDF gerado — foi assim que a marca parou no centro.
 */
export function recuoDiagonal(comprimento: number): number {
  return (comprimento / 2) * Math.cos(Math.PI / 4)
}


function dataHora(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Símbolo tem que sair como símbolo.
 *
 * A fonte padrão do PDF (helvetica) é WinAnsi e não tem `Ω` — escrever "ohm"
 * por extenso resolvia o arquivo ilegível, mas trocava o símbolo da medição
 * por texto, e a medição perde a unidade que está na ficha de papel. O certo é
 * embutir uma fonte que tenha o glifo: `simbolo` devolve a fonte de reserva só
 * quando o texto tem caractere fora do WinAnsi (µΩ, °, ≥...).
 */

/**
 * Carrega uma fonte Unicode (DejaVu) para o documento.
 *
 * O jsPDF só aceita fonte registrada por nome, e o registro precisa acontecer
 * depois de o documento existir. Por isso a fonte é preparada no começo do
 * relatório e o resto do código usa `esc()` para escolher a família.
 */
const FAMILIA_UNICODE = 'DejaVu'

/** Caractere fora do WinAnsi: precisa da fonte embutida para não virar lixo. */
const PRECISA_UNICODE = /[\u0100-\uffff]/

/**
 * Tipografia de um texto do relatório.
 *
 * `reserva` é a fonte padrão (helvetica), leve e já no leitor. Só trocamos para
 * a embutida quando o texto tem símbolo que a padrão não desenha — assim o PDF
 * não carrega fonte à toa, mas medição com `MΩ` sai com o símbolo certo.
 */
function fonte(
  doc: jsPDF,
  texto: string,
  estilo: 'normal' | 'bold',
  simbolos: boolean,
): string {
  const familia = simbolos && PRECISA_UNICODE.test(texto) ? FAMILIA_UNICODE : 'helvetica'
  doc.setFont(familia, estilo)
  return familia
}

/**
 * Sem a fonte embutida, símbolo vira texto — nunca lixo.
 *
 * O jsPDF não falha com caractere que a helvetica não tem: escreve o byte
 * errado e sai `M©`. Traduzir para "ohm" é feio, mas é legível; um relatório
 * de medição com unidade ilegível não serve para nada.
 */
function textoPdf(valor: string, simbolos: boolean): string {
  if (simbolos) return valor
  return valor.replace(/µΩ/g, 'µohm').replace(/MΩ/g, 'Mohm').replace(/Ω/g, 'ohm')
}

/**
 * Valor medido, sem a unidade (a tabela tem coluna própria para ela).
 *
 * Reaproveita `parseValor` para respeitar o que o técnico digitou: `∞` vira
 * `∞`, número sai com vírgula decimal.
 */
function semUnidade(item: ItemFicha, bruto: string): string {
  const v = parseValor(item, bruto)
  if (v === null) return '—'
  if (v === 'infinito') return '∞'
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',')
}

/** Nome de arquivo seguro: sem acento, sem espaço, sem barra. */
export function nomeDoArquivo(execucao: Execucao): string {
  const base = `${execucao.codigo}-${execucao.local || 'ficha'}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
  return `${base}.pdf`
}

/**
 * Registra a fonte Unicode no documento.
 *
 * As fontes ficam em `public/fonts` e são baixadas sob demanda: 1,4 MB não
 * podem entrar no pacote do app, que é usado offline no celular. Só a geração
 * de PDF paga esse custo.
 */
export async function carregarFonteSimbolos(): Promise<[string, string]> {
  const baixar = async (arquivo: string) => {
    const r = await fetch(`${import.meta.env.BASE_URL}fonts/${arquivo}`)
    if (!r.ok) throw new Error(`fonte ${arquivo}: HTTP ${r.status}`)
    const bytes = new Uint8Array(await r.arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 8192)
      s += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(s)
  }
  return [await baixar('DejaVuSans.ttf'), await baixar('DejaVuSans-Bold.ttf')]
}

/** A fonte já foi registrada nesta sessão? Evita 1,4 MB a cada PDF. */
let simbolosProntos = false

async function prepararSimbolos(): Promise<boolean> {
  if (simbolosProntos) return true
  try {
    const fontes = await carregarFonteSimbolos()
    fontesEmCache = fontes
    simbolosProntos = true
    return true
  } catch {
    return false
  }
}

let fontesEmCache: [string, string] | null = null

/** Registra a fonte no documento (cada PDF é um documento novo). */
function embutirFonteSimbolos(doc: jsPDF): void {
  if (!fontesEmCache) throw new Error('fonte não carregada')
  doc.addFileToVFS('DejaVuSans.ttf', fontesEmCache[0])
  doc.addFont('DejaVuSans.ttf', FAMILIA_UNICODE, 'normal')
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontesEmCache[1])
  doc.addFont('DejaVuSans-Bold.ttf', FAMILIA_UNICODE, 'bold')
}
export function gerarPdfRelatorio(
  { ficha, execucao, nomes }: Entrada,
  opcoes?: { simbolos?: boolean },
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  /** `simbolos` = a fonte Unicode já está carregada nesta sessão. */
  const simbolos = opcoes?.simbolos === true
  if (simbolos) embutirFonteSimbolos(doc)
  const margem = 14
  const largura = LARGURA_A4 - margem * 2
  let y = margem

  const quebrar = () => {
    if (y > 268) {
      doc.addPage()
      y = margem
    }
  }

  const tituloSecao = (texto: string) => {
    quebrar()
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(30, 41, 59)
    doc.text(texto.toUpperCase(), margem, y)
    y += 1.6
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.3)
    doc.line(margem, y, margem + largura, y)
    y += 4.5
  }

  const linha = (rotulo: string, valor: string) => {
    quebrar()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(rotulo, margem, y)
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    const texto = textoPdf(valor || '—', simbolos)
    fonte(doc, texto, 'normal', simbolos)
    const larguraRotulo = 42
    const partes = doc.splitTextToSize(texto, largura - larguraRotulo)
    doc.text(partes, margem + larguraRotulo, y)
    y += 4.6 * Math.max(1, partes.length)
  }

  // ---- Cabeçalho
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(15, 23, 42)
  doc.text(execucao.codigo || '—', margem, y + 2)

  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  doc.text('Ficha de Medição', margem + largura, y + 2, { align: 'right' })
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text(`${ficha.nome}`, margem, y)
  y += 6

  // Faixa de situação
  const situacao =
    execucao.status === 'concluida'
      ? 'CONCLUÍDA'
      : execucao.status === 'pendente'
        ? 'PENDENTE — MEDIÇÃO FORA DO LIMITE'
        : 'RASCUNHO'
  const corSituacao: [number, number, number] =
    execucao.status === 'concluida'
      ? [5, 150, 105]
      : execucao.status === 'pendente'
        ? [220, 38, 38]
        : [100, 116, 139]
  doc.setFillColor(...corSituacao)
  doc.roundedRect(margem, y, 68, 6, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(situacao, margem + 3, y + 4)
  y += 10

  // ---- Identificação
  tituloSecao('Identificação')
  linha('Equipamento', execucao.camposFixos.equipamento ?? '')
  linha('Local', execucao.local ?? '')
  linha('Modelo da ficha', ficha.nomeCurto)
  linha('Tipo de manutenção', execucao.tipoManutencao ?? (ficha.tiposManutencao[0] ?? ''))
  if (execucao.marca) linha('Marca', NOME_MARCA[execucao.marca] ?? execucao.marca)
  linha('Início', dataHora(execucao.dataHora))
  if (execucao.dataFim && execucao.dataFim !== execucao.dataHora) {
    linha('Encerramento', dataHora(execucao.dataFim))
  }

  // Núcleo só existe no contator
  const temNucleo = ficha.camposFixos.some(
    (c) => c.id === 'serieInstalado' || c.id === 'serieRetirado',
  )
  if (temNucleo) {
    linha(
      'Núcleo instalado',
      execucao.nucleoInstalado || execucao.camposFixos.serieInstalado || '',
    )
    linha('Núcleo retirado', execucao.camposFixos.serieRetirado ?? '')
  }
  // Campos extras da ficha (série, tensão, etc.)
  for (const campo of ficha.camposFixos) {
    if (['equipamento', 'rg1', 'rg2', 'rg3', 'rg4', 'rg5', 'rg6'].includes(campo.id)) continue
    if (campo.id === 'serieInstalado' || campo.id === 'serieRetirado') continue
    if (INSTRUMENTOS.some(([id]) => id === campo.id)) continue
    const valor = (execucao.camposFixos[campo.id] ?? '').trim()
    if (valor) linha(campo.nome, valor)
  }

  // ---- Equipe
  const equipe = [1, 2, 3, 4, 5, 6]
    .map((i) => (execucao.camposFixos[`rg${i}`] ?? '').trim())
    .filter(Boolean)
  if (equipe.length > 0) {
    tituloSecao('Equipe')
    for (const rg of equipe) linha('RG', `${rg}${nomes[rg] ? ` — ${nomes[rg]}` : ''}`)
  }

  // ---- Instrumentos
  const instrumentos = INSTRUMENTOS.filter(([campo]) =>
    Boolean((execucao.camposFixos[campo] ?? '').trim()),
  )
  if (instrumentos.length > 0) {
    tituloSecao('Instrumentos')
    for (const [campo, nome] of instrumentos) {
      linha(nome, execucao.camposFixos[campo] ?? '')
    }
  }

  // ---- Medições
  tituloSecao('Medições')

  const larguras = [8, 62, 32, 24, 34, 22]
  const colunas = ['#', 'Item', 'Medido', 'Unidade', 'Limite', 'Resultado']

  const cabecalhoTabela = () => {
    doc.setFillColor(241, 245, 249)
    doc.rect(margem, y - 4, largura, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(51, 65, 85)
    let x = margem + 1.5
    colunas.forEach((c, i) => {
      doc.text(c, x, y + 0.6)
      x += larguras[i]
    })
    y += 6
  }
  cabecalhoTabela()

  const valorDe = (itemId: string) =>
    execucao.valores.find((v) => v.itemId === itemId)?.valor ?? ''

  ficha.itens.forEach((item, indice) => {
    quebrar()
    const analise = avaliarItem(item, valorDe(item.id), execucao.marca)
    const rotulo =
      analise.resultado === 'conforme'
        ? 'Conforme'
        : analise.resultado === 'nao_conforme'
          ? 'Fora do limite'
          : analise.resultado === 'na'
            ? 'N/A'
            : '—'

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)

    const nomeItem = doc.splitTextToSize(item.nome, larguras[1] - 2)
    const alturaLinha = Math.max(6, nomeItem.length * 3.6 + 2.6)

    let x = margem + 1.5
    doc.setTextColor(100, 116, 139)
    doc.text(String(indice + 1), x, y + 1)
    x += larguras[0]
    doc.setTextColor(15, 23, 42)
    doc.text(nomeItem, x, y + 1)
    x += larguras[1]
    doc.setFont('helvetica', 'bold')
    /**
     * O medido é tratado como o resto: `∞` (isolação) não existe na helvetica
     * e saía como aspas tortas. A unidade tem coluna própria aqui, então o
     * valor sai sem ela — igual ao de papel.
     */
    const medido = textoPdf(semUnidade(item, valorDe(item.id)), simbolos)
    fonte(doc, medido, 'bold', simbolos)
    doc.text(medido, x, y + 1)
    doc.setFont('helvetica', 'normal')
    x += larguras[2]
    // Unidade e limite carregam o símbolo (MΩ); a fonte tem que acompanhar.
    const unid = textoPdf(item.unidade, simbolos)
    fonte(doc, unid, 'normal', simbolos)
    doc.text(unid, x, y + 1)
    x += larguras[3]
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    const lim = textoPdf(analise.limiteExibido, simbolos)
    fonte(doc, lim, 'normal', simbolos)
    doc.text(doc.splitTextToSize(lim, larguras[4] - 2), x, y + 1)
    x += larguras[4]
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(
      ...(analise.resultado === 'conforme'
        ? ([5, 150, 105] as [number, number, number])
        : analise.resultado === 'nao_conforme'
          ? ([220, 38, 38] as [number, number, number])
          : ([100, 116, 139] as [number, number, number])),
    )
    doc.text(rotulo, x, y + 1)

    y += alturaLinha
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.15)
    doc.line(margem, y - 3.2, margem + largura, y - 3.2)
  })

  // ---- Observação
  if ((execucao.observacaoGeral ?? '').trim()) {
    tituloSecao('Observação')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(15, 23, 42)
    // Texto livre: o técnico pode escrever `∞` ou `Ω` na observação.
    const obs = textoPdf(execucao.observacaoGeral ?? '', simbolos)
    fonte(doc, obs, 'normal', simbolos)
    const texto = doc.splitTextToSize(obs, largura)
    for (const pedaco of texto) {
      quebrar()
      doc.text(pedaco, margem, y)
      y += 4.4
    }
  }

  // ---- Rodapé em todas as páginas
  const paginas = doc.getNumberOfPages()

  /**
   * Marca d'água na diagonal central da folha.
   *
   * Bem clara de propósito: é para identificar o documento de relance, não para
   * competir com a medição. Desenhada no fim, página por página, porque só aqui
   * se sabe quantas páginas o relatório tem.
   *
   * Ocupar 75%: a diagonal do A4 mede ~363 mm e 75% disso é o comprimento que a
   * marca deve cobrir. Em vez de chutar um corpo de fonte, o texto é escalado
   * até encostar nesse comprimento — assim a mesma regra vale para "CLI-CT01" e
   * para um código longo.
   */
  const DIAGONAL_A4 = Math.hypot(LARGURA_A4, ALTURA_A4)
  const comprimentoAlvo = DIAGONAL_A4 * 0.75
  /**
   * A versão anterior media o texto pelo `getTextWidth`, que ignora a caixa
   * dos glifos girados e as hastes que passam dela (o "O" final). Resultado: a
   * tinta ia até 209,6 mm numa folha de 210 mm — o "O" saía cortado e o "R"
   * ficava 14 mm longe da borda. A conta agora é calibrada pela **tinta**,
   * medida no PDF renderizado.
   */
  /**
   * Fator entre a largura declarada da fonte e a **tinta** que sai na folha.
   *
   * Calibrado renderizando a página e medindo os pixels: pedindo 75% da
   * diagonal a marca desenhava 276 mm e encostava na borda direita (o "O"
   * saía cortado). Com este fator ela mede 271 mm e sobra ~9 mm de cada lado.
   * Mexer aqui obriga a remedir o PDF renderizado, não o `pdftotext`.
   */
  const comprimentoDesenho = comprimentoAlvo * FATOR_DESENHO_MARCA

  /** Ponto onde as diagonais da folha se cruzam: o centro geométrico. */
  const centroX = LARGURA_A4 / 2
  const centroY = ALTURA_A4 / 2

  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p)

    /**
     * A marca d'água é sempre a palavra RASCUNHO.
     *
     * Fixa de propósito: é o aviso de que o papel não vale como ficha — não é
     * identificação do equipamento. Se um dia esse PDF for emitido como versão
     * final, esta palavra é o que precisa mudar, e ela muda aqui e só aqui.
     */
    const textoMarca = 'RASCUNHO'
    doc.setFont(simbolos ? FAMILIA_UNICODE : 'helvetica', 'bold')
    doc.setFontSize(CORPO_REFERENCIA)

    /**
     * Corpo da fonte por proporção.
     *
     * Mede o texto num corpo conhecido e aplica a regra de três para o tamanho
     * que faz a marca cobrir exatamente `comprimentoAlvo`. Busca por passos
     * ("diminui 2 até caber") deixava a marca menor do que o pedido sempre que o
     * código era curto.
     */
    doc.setFontSize(
      corpoParaComprimento(doc.getTextWidth(textoMarca), comprimentoDesenho),
    )

    doc.saveGraphicsState()
    /**
     * Transparência da marca d'água.
     *
     * O jsPDF não aceita objeto literal aqui: `setGState` chama `.equals()` no
     * valor recebido e o PDF inteiro quebra com "e.equals is not a function".
     * Tem que ser a instância devolvida pela fábrica `GState()`.
     */
    const fabrica = (doc as unknown as { GState?: (p: { opacity: number }) => unknown }).GState
    if (typeof fabrica === 'function') doc.setGState(fabrica({ opacity: 0.07 }) as never)
    doc.setTextColor(30, 41, 59)
    /**
     * Âncora calculada à mão — `align: 'center'` **não** serve aqui.
     *
     * Medido no PDF gerado: com `align: 'center'` + `angle`, a marca sai com o
     * centro em (11, 76) mm em vez de (105, 148) e comprimento errado. O jsPDF
     * desconta meia largura em coordenadas de tela e depois gira, o que não é o
     * que a leitura ingênua da API sugere.
     *
     * Com `angle` e sem `align`, a âncora é a **ponta inicial** do texto e a
     * rotação acontece em torno dela — comportamento previsível. O texto sobe
     * para a direita em 45°, então para o meio cair no centro da folha a ponta
     * recua metade da projeção na diagonal em cada eixo (comprimento/2 × cos45°).
     */
    const recuo = recuoDiagonal(comprimentoDesenho)
    /**
     * Deslocamento de acerto do centro.
     *
     * Medido no PDF: com a âncora calculada pela conta exata a marca sai ~44 mm
     * à esquerda e ~10 mm abaixo do centro. O jsPDF mede o texto antes de girar
     * e a caixa dos glifos girados é diferente, então sobra este resíduo. É
     * constante para a mesma fonte e o mesmo ponto de partida — calibrado por
     * medição, não deduzido.
     */
    doc.text(textoMarca, centroX - recuo + AJUSTE_CENTRO_X, centroY + recuo + AJUSTE_CENTRO_Y, {
      angle: 45,
    })
    doc.restoreGraphicsState()

    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.line(margem, 283, margem + largura, 283)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(`${execucao.codigo} · ${ficha.nomeCurto}`, margem, 288)
    doc.text(`Gerado em ${dataHora(new Date().toISOString())}`, margem + largura / 2, 288, {
      align: 'center',
    })
    doc.text(`${p}/${paginas}`, margem + largura, 288, { align: 'right' })
  }

  return doc
}

/**
 * Gera e salva o relatório no aparelho.
 *
 * Sempre tenta embutir a DejaVu: o símbolo `Ω` da medição tem que sair como
 * símbolo. Se o download da fonte falhar (primeiro uso offline), o documento
 * ainda é gerado com a unidade por extenso — em campo, um PDF legível vale
 * mais que nenhum PDF.
 */
export async function baixarPdfRelatorio(entrada: Entrada): Promise<{ comSimbolos: boolean }> {
  const comSimbolos = await prepararSimbolos()
  const doc = gerarPdfRelatorio(entrada, { simbolos: comSimbolos })
  doc.save(nomeDoArquivo(entrada.execucao))
  return { comSimbolos }
}
