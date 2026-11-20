import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const page = await (await browser.newContext({ viewport:{width:390,height:844} })).newPage()
await page.goto('http://127.0.0.1:4173', { waitUntil:'networkidle' })
await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('fichas-metro'); r.onsuccess = () => res(r.result) })
  await new Promise((res) => {
    const tx = db.transaction('config','readwrite')
    tx.objectStore('config').put({ chave:'cadastro:equipamentos', valor: JSON.stringify([{id:'e1',nome:'CT 02 — CD1',fichaId:'SC-BI1',local:'Linha 2 — CD1',marca:'',serie:'4PB 004'}]) })
    tx.oncomplete = res
  })
})
await page.reload({ waitUntil:'networkidle' })
await page.getByRole('button', { name: /Seccionador BI 1/ }).first().click()
await page.waitForTimeout(900)
await page.getByText('Selecionar equipamento').click()
await page.waitForTimeout(400)
await page.locator('div.absolute.inset-x-0.top-full button').first().click()
await page.waitForTimeout(600)
const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => i.placeholder + ' => ' + i.value))
console.log(inputs)
console.log('botão agora:', await page.getByText('CT 02').count())
await browser.close()
