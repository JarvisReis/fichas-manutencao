import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

/**
 * Service worker do PWA.
 *
 * `registerType: 'autoUpdate'` já manda o worker novo assumir na hora. O aviso
 * daqui é para o técnico: quando sai versão nova, o app recarrega sozinho —
 * antes ele ficava preso na tela antiga sem ninguém perceber, o que já custou
 * uma tarde de depuração achando que o código não tinha subido.
 */
const atualizarSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Há versão nova em cache. Atualiza e recarrega: em campo não dá para pedir
    // ao técnico que "puxe para atualizar" no meio de uma medição.
    void atualizarSW(true)
  },
  onOfflineReady() {
    console.info('[fichas] app pronto para uso offline')
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
