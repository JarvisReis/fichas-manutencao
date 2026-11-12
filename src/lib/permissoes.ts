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
  status: 'rascunho' | 'concluida'
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
