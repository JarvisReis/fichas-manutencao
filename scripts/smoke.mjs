import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5173/'
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
page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(`console: ${m.text()}`)
})

const passos = []
const passo = (nome) => passos.push(nome)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/shot-1-home.png' })
passo('home carregada')

// contator BI
await page.getByText('Contator BI').first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/shot-2-identificacao.png' })

await page.getByPlaceholder('Ex.: Linha 2 — CD1').fill('Linha 2 — CD1')
await page.getByRole('button', { name: 'P2' }).click()
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/shot-3-identificacao.png', fullPage: true })
passo('identificação preenchida')

await page.getByRole('button', { name: /Iniciar medições/ }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/shot-4-execucao.png' })

const inputs = await page.locator('input[inputmode="decimal"]').all()
await inputs[0].fill('120') // fora do limite (máx 80)
await inputs[1].fill('12,5') // conforme
await inputs[2].fill('500')
await inputs[3].fill('500')
await inputs[4].fill('500')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/shot-5-execucao-preenchida.png', fullPage: true })
passo('medições preenchidas com não conformidade')

const textoConformidade = await page.locator('body').innerText()
const detectouFora = textoConformidade.includes('FORA DO LIMITE')

// concluir sem foto -> bloqueia
await page.getByRole('button', { name: /Concluir/ }).click()
await page.waitForTimeout(400)
const avisoBloqueio = (await page.locator('body').innerText()).includes('Foto obrigatória em')
await page.screenshot({ path: '/tmp/shot-6-aviso.png' })
passo('bloqueio por falta de foto')

// anexa foto no item fora do limite (item 1)
const fileInputs = await page.locator('input[type="file"]').all()
await fileInputs[0].setInputFiles({
  name: 'medicao.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    // JPEG mínimo válido (1x1 cinza)
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
})
await page.waitForTimeout(1200)
await page.screenshot({ path: '/tmp/shot-7-com-foto.png' })
passo('foto anexada e comprimida')

// conclui
await page.getByRole('button', { name: /Concluir/ }).click()
await page.waitForTimeout(800)
const textoFinal = await page.locator('body').innerText()
const concluiu = textoFinal.includes('Execução concluída')
await page.screenshot({ path: '/tmp/shot-8-concluida.png' })
passo('execução concluída')

// histórico
await page.getByRole('button', { name: 'Ver histórico' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: '/tmp/shot-9-historico.png', fullPage: true })
const textoHist = await page.locator('body').innerText()
const noHistorico = textoHist.includes('CT-') && textoHist.includes('fora do limite')
passo('histórico com a execução')

// recarrega para provar persistência offline
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const textoRecarga = await page.locator('body').innerText()
const persistiu = textoRecarga.includes('aguardando sincronização') || textoRecarga.includes('Continuar')
passo('persistência após reload')
await page.screenshot({ path: '/tmp/shot-10-reload.png' })

await browser.close()

const resultado = {
  erros,
  detectouFora,
  avisoBloqueio,
  concluiu,
  noHistorico,
  persistiu,
  passos,
  ok: erros.length === 0 && detectouFora && avisoBloqueio && concluiu && noHistorico && persistiu,
}
console.log(JSON.stringify(resultado, null, 2))
process.exit(resultado.ok ? 0 : 1)
