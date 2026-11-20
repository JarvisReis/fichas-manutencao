/**
 * Números de série dos núcleos de contator.
 *
 * Lista fixa (referência), espelhando a lista `Núcleos HPB` do cadastro:
 * HPB001 a HPB099. A alocação em contator e a manutenção P2 vivem nas listas
 * `Contatores` e `Manutenções` — aqui só existe a referência para os campos
 * "Nº Série do Núcleo — Instalado" e "— Retirado" das fichas.
 */
export const NUCLEOS_HPB: string[] = Array.from(
  { length: 99 },
  (_, i) => `HPB${String(i + 1).padStart(3, '0')}`,
)
