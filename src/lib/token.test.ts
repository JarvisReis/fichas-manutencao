import { describe, expect, it } from 'vitest'
import { tokenVencendo, venceEm } from './auth'

/**
 * Validade do token de acesso.
 *
 * O defeito que isto previne: o app guardava o token no localStorage e nunca
 * olhava o vencimento. Passada a hora, toda sincronização respondia 401 e o
 * app não dizia nada — o dado só voltava a andar depois de sair da conta e
 * entrar de novo, o que fazia parecer que "sincronizar só funciona no login".
 */

/** Monta um JWT de mentira: só o payload importa para o vencimento. */
function jwt(exp: number): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp })}.assinatura`
}

describe('venceEm', () => {
  it('lê o exp do JWT e devolve em milissegundos', () => {
    expect(venceEm(jwt(1_800_000_000))).toBe(1_800_000_000_000)
  })

  it('token ausente ou lixo devolve null', () => {
    expect(venceEm(null)).toBeNull()
    expect(venceEm('')).toBeNull()
    expect(venceEm('nao-e-jwt')).toBeNull()
    expect(venceEm('a.b.c')).toBeNull()
  })
})

describe('tokenVencendo', () => {
  it('token válido por horas não está vencendo', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    expect(tokenVencendo(jwt(exp))).toBe(false)
  })

  it('token já vencido está vencendo', () => {
    const exp = Math.floor(Date.now() / 1000) - 10
    expect(tokenVencendo(jwt(exp))).toBe(true)
  })

  it('token que vence dentro da margem conta como vencendo', () => {
    // margem de 2 min cobre o tempo da chamada; 30 s de folga é pouco
    const exp = Math.floor(Date.now() / 1000) + 30
    expect(tokenVencendo(jwt(exp))).toBe(true)
  })

  it('sem token, trata como vencendo', () => {
    expect(tokenVencendo(null)).toBe(true)
  })
})