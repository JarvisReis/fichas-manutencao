/**
 * Janela de correção depois de concluir.
 *
 * Concluir não é cofre imediato: quem executou tem 24 horas para corrigir o que
 * digitou errado (número trocado, foto errada). Passada a janela — ou quando outra
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
