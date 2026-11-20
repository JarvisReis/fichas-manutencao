import { extrairRgs } from './cadastros'

/**
 * Janela de correção depois de concluir.
 *
 * Concluir não é cofre imediato: quem executou tem 24 horas para corrigir o que
 * digitou errado (número trocado, equipe errada). Passada a janela — ou quando outra
 * pessoa tenta editar — a ficha fica com o administrador.
 */
export const JANELA_CORRECAO_MS = 24 * 60 * 60 * 1000

export type PodeEditar =
  | { pode: true; motivo: 'rascunho' | 'administrador' | 'janela' }
  | { pode: false; motivo: 'fechada' }

export interface ExecucaoMinima {
  /** `pendente` conta como ficha fechada: mesmo fluxo de correção da concluída. */
  status: 'rascunho' | 'concluida' | 'pendente'
  atualizadaEm: string
}

/**
 * Regra única, usada pela abertura da rota, pelo histórico e pela tela de execução.
 *
 * - rascunho: quem está trabalhando nele;
 * - concluída: administrador sempre; o executor só dentro das 24 h;
 * - sem sessão: só rascunho (nada de reabrir ficha fechada).
 */
export function podeEditarExecucao(
  execucao: ExecucaoMinima,
  sessao: { pessoaId: string; nivel: 'administrador' | 'usuario' } | null,
  executorId: string | null | undefined,
  agora: number = Date.now(),
): PodeEditar {
  if (sessao?.nivel === 'administrador') {
    return { pode: true, motivo: execucao.status === 'rascunho' ? 'rascunho' : 'administrador' }
  }
  if (execucao.status === 'rascunho') return { pode: true, motivo: 'rascunho' }
  if (!sessao || !executorId || sessao.pessoaId !== executorId) {
    return { pode: false, motivo: 'fechada' }
  }
  const concluidaEm = Date.parse(execucao.atualizadaEm)
  if (Number.isNaN(concluidaEm)) return { pode: false, motivo: 'fechada' }
  if (agora - concluidaEm > JANELA_CORRECAO_MS) return { pode: false, motivo: 'fechada' }
  return { pode: true, motivo: 'janela' }
}

/** Quanto falta da janela de 24 h, em texto curto ("3 h 12 min"). */
export function tempoRestanteJanela(execucao: ExecucaoMinima, agora: number = Date.now()): string {
  const concluidaEm = Date.parse(execucao.atualizadaEm)
  if (Number.isNaN(concluidaEm)) return ''
  const resta = JANELA_CORRECAO_MS - (agora - concluidaEm)
  if (resta <= 0) return ''
  const horas = Math.floor(resta / 3_600_000)
  const minutos = Math.floor((resta % 3_600_000) / 60_000)
  return horas > 0 ? `${horas} h ${minutos} min` : `${minutos} min`
}

/**
 * Rascunho esquecido some sozinho depois de 5 dias.
 *
 * Rascunho é trabalho pela metade: sem essa limpeza, todo equipamento que
 * alguém abriu e abandonou fica para sempre na seção "Continuar" da home, e a
 * lista deixa de ser "o que estou fazendo" para virar depósito. Cinco dias
 * cobre folga de fim de semana e feriado sem apagar trabalho de verdade — quem
 * parou no meio da ficha volta na segunda e ela ainda está lá.
 *
 * Só rascunho expira. Concluída e pendente são registro do serviço, não
 * trabalho em andamento: essas nunca somem sozinhas.
 */
export const VALIDADE_RASCUNHO_MS = 5 * 24 * 60 * 60 * 1000

export function rascunhoExpirado(
  execucao: ExecucaoMinima,
  agora: number = Date.now(),
): boolean {
  if (execucao.status !== 'rascunho') return false
  const salvoEm = Date.parse(execucao.atualizadaEm)
  if (Number.isNaN(salvoEm)) return false
  return agora - salvoEm > VALIDADE_RASCUNHO_MS
}

/** Quanto falta para o rascunho expirar, em dias ("2 dias", "1 dia"). */
export function validadeDoRascunho(execucao: ExecucaoMinima, agora: number = Date.now()): string {
  const salvoEm = Date.parse(execucao.atualizadaEm)
  if (Number.isNaN(salvoEm)) return ''
  const resta = VALIDADE_RASCUNHO_MS - (agora - salvoEm)
  if (resta <= 0) return ''
  const dias = Math.ceil(resta / 86_400_000)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/**
 * Quem pode apagar um rascunho.
 *
 * A exclusão do rascunho era só do administrador, e isso deixava o técnico
 * preso: ele abria a ficha errada, ou desistia do serviço, e o rascunho ficava
 * na home dele por cinco dias até expirar — sem nenhuma forma de limpar o que
 * era dele. Rascunho é trabalho em andamento de quem está com o aparelho na
 * mão; se a regra de edição já é essa, a de apagar tem que ser a mesma.
 *
 * Três limites, para não virar porta aberta:
 *  - precisa de sessão (sem login, ninguém apaga nada);
 *  - administrador apaga qualquer um;
 *  - usuário só apaga rascunho, e só o dele — rascunho sem autor é ficha aberta
 *    antes do login neste aparelho, então também é dele.
 *
 * Ficha fechada (concluída/pendente) nunca entra aqui: essa é registro do
 * serviço e a exclusão passa pelo histórico, com o servidor sabendo.
 */
export function podeApagarRascunho(
  execucao: { status: 'rascunho' | 'concluida' | 'pendente'; criadaPor?: string },
  sessao: { pessoaId: string; nivel: 'administrador' | 'usuario' } | null,
): boolean {
  if (!sessao) return false
  if (sessao.nivel === 'administrador') return true
  if (execucao.status !== 'rascunho') return false
  if (!execucao.criadaPor) return true
  return execucao.criadaPor === sessao.pessoaId
}

/**
 * Quais números de série de núcleo ainda faltam.
 *
 * Existe separado do componente por um motivo concreto: a conferência lia os
 * núcleos de `camposFixos`, mas o seletor de núcleo grava em estado próprio e
 * só junta tudo ao sair da tela. Resultado em campo — o técnico escolhia o
 * núcleo retirado, apertava Próximo e o app acusava "falta o número de série do
 * núcleo retirado" com o campo preenchido na frente dele, sem deixar avançar
 * para as medições.
 *
 * Regra: núcleo instalado é sempre obrigatório; retirado só na P2, onde ele é o
 * registro da peça que saiu do contator — e só quando existe manutenção
 * anterior de onde ele venha. Contator na primeira P2 não tem o que retirar, e
 * exigir a série ali travaria a ficha por um dado que não existe.
 */
export function nucleosEmBranco(
  ehP2: boolean,
  instalado: string | undefined,
  retirado: string | undefined,
  exigirRetirado = true,
): string[] {
  const faltando: string[] = []
  if (!(instalado ?? '').trim()) faltando.push('Nº Série do Núcleo — Instalado')
  if (ehP2 && exigirRetirado && !(retirado ?? '').trim()) {
    faltando.push('Nº Série do Núcleo — Retirado')
  }
  return faltando
}

/**
 * Identificação completa: pode sair da tela de identificação para as medições.
 *
 * A ficha é preenchida em dupla e todo registro precisa dizer QUEM mediu, ONDE
 * e PARA QUÊ. Rascunho existe para sobreviver a recarregar a página, não para
 * virar atalho: entrar em medições com equipe incompleta produz ficha que não
 * pode ser concluída depois, e o técnico só descobre no fim.
 *
 * O tipo NUNCA barra: o contrato é "não escolheu, salva como P1". Foi assim
 * desde o começo e é o que evita técnico preso numa tela por um campo que o
 * app já sabe preencher sozinho — o primeiro tipo da ficha é o padrão.
 */
export interface IdentificacaoMinima {
  local?: string
  marca?: string
  tipoManutencao?: string
  camposFixos: Record<string, string>
}

export function identificacaoCompleta(
  execucao: IdentificacaoMinima,
  opcoes: { exigeMarca?: boolean } = {},
): boolean {
  const local = (execucao.local ?? '').trim()
  const equipe = extrairRgs(execucao.camposFixos).length
  if (local.length === 0) return false
  if (equipe < 2) return false
  if (opcoes.exigeMarca && !(execucao.marca ?? '').trim()) return false
  return true
}
