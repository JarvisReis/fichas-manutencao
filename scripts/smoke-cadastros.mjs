import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4173'
const erros = []

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
})
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text())
})
page.on('pageerror', (e) => erros.push('pageerror: ' + e.message))

const passo = (m) => console.log('· ' + m)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

// 1. tema
await page.getByLabel('Ativar modo escuro').click()
await page.waitForTimeout(400)
const escuro = await page.evaluate(() => document.documentElement.classList.contains('tema-escuro'))
passo('modo escuro aplicado: ' + escuro)
await page.screenshot({ path: '.shots/tema-escuro-home.png' })
await page.getByLabel('Ativar modo claro').click()
await page.waitForTimeout(300)

// 2. cadastros -> funcionário
await page.getByText('Equipe e equipamentos').click()
await page.waitForTimeout(500)
await page.getByText('Novo funcionário').click()
await page.getByPlaceholder('Nome completo').fill('João da Silva')
await page.getByPlaceholder('Ex.: 09233.9').fill('09233.9')
await page.getByPlaceholder('Ex.: Eletricista de manutenção').fill('Eletricista')
await page.getByRole('button', { name: 'Administrador' }).click()
await page.getByRole('button', { name: 'Salvar' }).click()
await page.waitForTimeout(400)

await page.getByText('Novo funcionário').click()
await page.getByPlaceholder('Nome completo').fill('Maria Souza')
await page.getByPlaceholder('Ex.: 09233.9').fill('18164')
await page.getByRole('button', { name: 'Salvar' }).click()
await page.waitForTimeout(400)

await page.getByText('Novo funcionário').click()
await page.getByPlaceholder('Nome completo').fill('Pedro Inativo')
await page.getByPlaceholder('Ex.: 09233.9').fill('99999')
await page.getByText('Ativo — aparece na seleção').click()
await page.getByRole('button', { name: 'Salvar' }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: '.shots/cadastros-funcionarios.png' })

// 3. equipamento
await page.getByText(/Equipamentos \(/).click()
await page.waitForTimeout(400)
await page.getByText('Novo equipamento').click()
await page.waitForTimeout(300)
await page.getByPlaceholder('Ex.: CT 02 — CD1').fill('CT 02 — CD1')
await page.selectOption('select', { label: 'Seccionador BI 1' })
await page.getByPlaceholder('Ex.: Linha 2 — CD1').fill('Linha 2 — CD1')
await page.getByPlaceholder('4PB 004').fill('4PB 004')
await page.getByRole('button', { name: 'Salvar' }).click()
await page.waitForTimeout(600)
const txtEquip = await page.textContent('body')
passo('equipamento salvo: ' + txtEquip.includes('CT 02'))
await page.screenshot({ path: '.shots/cadastros-equipamentos.png' })

// 4. nova execução de seccionador (P1)
await page.getByLabel('Voltar').click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: /Seccionador BI 1/ }).first().click()
await page.waitForTimeout(700)
const tipoTexto = await page.textContent('body')
passo('seccionador mostra P1: ' + tipoTexto.includes('P1 — única manutenção prevista'))
await page.screenshot({ path: '.shots/identificacao-seccionador.png' })

// 5. dropdown pesquisável (já estamos na identificação do Seccionador)
await page.getByText('Selecionar equipamento').click()
await page.waitForTimeout(400)
const drop = page.locator('div.absolute.inset-x-0.top-full')
const campoLocal = page.locator('input[placeholder="Ex.: Linha 2 — CD1"]')
await page.getByPlaceholder('Buscar por nome, local ou série').fill('linha 2')
await page.waitForTimeout(400)
passo('resultado busca: ' + (await drop.textContent()).replace(/\s+/g, ' ').slice(0, 80))
await drop.locator('button').first().click()
await page.waitForTimeout(400)
const localPreenchido = await campoLocal.inputValue({ timeout: 5000 }).catch(() => "nao-encontrado")
passo('local autopreenchido: ' + JSON.stringify(localPreenchido))

// 6. equipe: inativo nao aparece
const corpo = await page.textContent('body')
passo('Pedro Inativo oculto: ' + !corpo.includes('Pedro Inativo'))
passo('João da Silva visível: ' + corpo.includes('João da Silva'))
await page.getByText('João da Silva').click()
await page.getByText('Maria Souza').click()
await page.waitForTimeout(400)
await page.screenshot({ path: '.shots/identificacao-equipe.png' })

console.log('\nERROS CONSOLE:', erros.length ? erros : 'nenhum')
await browser.close()
