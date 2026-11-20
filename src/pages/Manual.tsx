import { ArrowLeft, BookOpen } from 'lucide-react'

/**
 * Manual de uso dentro do app.
 *
 * Fica aqui, e não num PDF solto ou num site, por dois motivos de campo: o
 * técnico abre no mesmo lugar onde trabalha (sem baixar arquivo nem procurar
 * link) e continua lendo com o aparelho **sem rede** — que é a situação normal
 * dentro de uma subestação.
 *
 * O texto é o combinado com quem usa: passo a passo curto, sem jargão de
 * sistema. Quando a regra muda no app, muda aqui também.
 */
export default function Manual({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <BookOpen size={16} /> Manual de uso
            </p>
            <p className="text-xs text-slate-500">Fichas de medição — contator e seccionadora</p>
          </div>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <Secao titulo="O que é este aplicativo">
          <p>
            É a ficha de papel do contator e da seccionadora, preenchida no celular. Funciona
            <strong> sem internet</strong>: os dados ficam no aparelho e sobem para o servidor
            quando houver rede. Nada do que você mediu se perde por falta de sinal.
          </p>
        </Secao>

        <Secao titulo="Entrar e sair">
          <ul>
            <li>Toque em <strong>Entrar</strong> (canto superior) e use seu e-mail e senha.</li>
            <li>A conta é criada pelo administrador por convite — o link chega no seu e-mail.</li>
            <li>A sessão fica salva no aparelho e se renova sozinha. Se o app pedir senha de novo, é porque a renovação venceu.</li>
            <li><strong>Sair</strong> apaga a sessão <em>do aparelho</em>. As fichas continuam gravadas nele.</li>
          </ul>
        </Secao>

        <Secao titulo="Tela inicial">
          <ul>
            <li><strong>Contator / Seccionadora</strong>: abas no topo. Cada tipo tem sua ficha.</li>
            <li><strong>Continuar</strong>: rascunhos abertos, um cartão por equipamento. Rascunho esquecido desaparece sozinho após <strong>5 dias</strong>.</li>
            <li><strong>Mais recente</strong>: últimas manutenções feitas no equipamento.</li>
            <li><strong>Prioridade</strong>: os equipamentos que estão há mais tempo sem manutenção.</li>
            <li>O cartão mostra <strong>NÃO ENVIADO</strong> quando a ficha só existe no aparelho.</li>
          </ul>
        </Secao>

        <Secao titulo="Preencher uma ficha">
          <p>Toque no equipamento e siga as abas na ordem. Cada aba é um bloco da ficha de papel.</p>
          <ol>
            <li>
              <strong>Identificação</strong> — local, tipo de manutenção (P1/P2), datas. A data de
              início é a de hoje; o encerramento é o segundo dia quando a ficha cobre dois dias.
            </li>
            <li>
              <strong>Equipe</strong> — marque no mínimo <strong>duas pessoas</strong>. Sem dupla não
              se avança: é o registro de quem mediu.
            </li>
            <li>
              <strong>Núcleo</strong> (só contator) — veja o tópico abaixo, a regra muda entre P1 e P2.
            </li>
            <li>
              <strong>Instrumentos</strong> — patrimônio do micro-ohmímetro, megômetro e torquímetro
              usados. O app sugere o último usado, mas quem confirma é você.
            </li>
            <li>
              <strong>Medições</strong> — um item por vez, com o limite na tela.
            </li>
          </ol>
          <p>
            Os campos em branco são conferidos ao tocar em <strong>Próximo</strong> na última aba: o
            app lista o que falta e não deixa seguir enquanto houver pendência.
          </p>
        </Secao>

        <Secao titulo="Núcleo: a diferença entre P1 e P2">
          <ul>
            <li>
              <strong>P1</strong> — o núcleo não é trocado. O campo <em>núcleo instalado</em> vem do
              cadastro do equipamento e fica só para leitura. Só é preenchido à mão na primeira
              manutenção do contator, quando ainda não há registro.
            </li>
            <li>
              <strong>P2</strong> — há troca de núcleo. O campo <em>núcleo retirado</em> vem{' '}
              <strong>preenchido</strong> com o núcleo da manutenção anterior (é o que está saindo) e
              pode ser corrigido se o registro estiver errado. O campo <em>núcleo instalado</em> abre{' '}
              <strong>vazio</strong>, esperando a série do núcleo novo.
            </li>
            <li>
              Se o contator <strong>nunca teve manutenção</strong>, não há o que retirar: o campo fica
              vazio e isso é normal, não é falta de dado.
            </li>
            <li>
              A série do núcleo é uma lista fechada (HPB001 a HPB099). Se a peça não estiver na
              lista, avise o administrador.
            </li>
          </ul>
        </Secao>

        <Secao titulo="Medições e limites">
          <ul>
            <li>Digite o valor medido. O app mostra na hora se está <strong>conforme</strong> ou <strong>fora do limite</strong>.</li>
            <li>O símbolo <strong>∞</strong> é válido como leitura (isolamento infinito).</li>
            <li>
              Item que não se aplica ao equipamento daquela marca fica como <strong>N/A</strong> —
              não é zero nem reprovado.
            </li>
            <li>
              Se o app avisar <strong>“Limite revisado depois desta medição”</strong>, quer dizer que o
              administrador mudou o limite depois que a ficha foi preenchida. O valor medido continua
              o mesmo; o aviso serve para quem for auditar.
            </li>
          </ul>
        </Secao>

        <Secao titulo="Concluir e gerar o PDF">
          <ul>
            <li><strong>Concluir</strong> fecha a ficha. Com alguma medição fora do limite, ela é salva como <strong>pendente</strong> — não trava o serviço, fica marcada para tratamento.</li>
            <li>Depois de concluída, a ficha fica <strong>somente leitura</strong>. O executor ainda pode corrigir dentro de 24 horas; passado isso, só o administrador.</li>
            <li><strong>Baixar relatório em PDF</strong> gera o documento da ficha, com identificação, equipe, instrumentos, medições e observação.</li>
          </ul>
        </Secao>

        <Secao titulo="Sem internet e sincronização">
          <ul>
            <li>Pode preencher e concluir offline. A ficha entra na fila e sobe sozinha quando houver rede (ao abrir o app, ao voltar para ele ou quando a rede volta).</li>
            <li>O cabeçalho da tela inicial mostra quantas execuções estão aguardando envio.</li>
            <li>O app envia uma <strong>cópia de segurança</strong> automática para o servidor a cada sincronização.</li>
            <li>Ao abrir, o aparelho também <strong>recebe</strong> as fichas concluídas pela equipe.</li>
            <li>O que ainda não subiu nunca é apagado pela sincronização. Ficha apagada no servidor sai do aparelho; ficha que só existe aqui fica aqui.</li>
          </ul>
        </Secao>

        <Secao titulo="Histórico, fila de envio e backup (menu)">
          <ul>
            <li><strong>Histórico e fila de envio</strong> — todas as fichas do aparelho, o que está pendente e o que já subiu.</li>
            <li><strong>Backup das execuções</strong> — baixa um arquivo com tudo o que está no aparelho. Guarde fora do celular.</li>
            <li><strong>Recuperação</strong> — restaura um backup baixado ou uma cópia guardada no servidor.</li>
          </ul>
        </Secao>

        <Secao titulo="Para o administrador">
          <ul>
            <li><strong>Equipe e equipamentos</strong> — cadastro de pessoas (com ou sem conta), equipamentos e o editor de fichas.</li>
            <li>
              <strong>Editor de fichas</strong> — revisa nome, pontos de medição e <strong>limites</strong>.
              O que é salvo aqui é <strong>publicado para a equipe</strong> e passa a valer em todos os
              aparelhos na próxima sincronização. A tela mostra quem publicou e quando.
            </li>
            <li><strong>Convite</strong> — o técnico recebe e-mail e define a própria senha. O administrador nunca precisa saber a senha de ninguém.</li>
            <li>Ficha concluída pode ser corrigida pelo administrador a qualquer momento.</li>
            <li>Duas pessoas não abrem a mesma ficha: a identidade da ficha é o código (equipamento + data). Se outra pessoa já concluiu, o rascunho seu aparece marcado como <strong>concluída em outro aparelho</strong>.</li>
          </ul>
        </Secao>

        <Secao titulo="Ajustes do próprio aparelho">
          <ul>
            <li><strong>Trocar minha senha</strong> — no menu. Vale para a sua conta.</li>
            <li><strong>Lua / Sol</strong> — alterna modo escuro e claro. A escolha fica salva.</li>
            <li>Adicionar o app à tela inicial (menu do navegador → “Adicionar à tela inicial”) faz ele abrir em tela cheia, como aplicativo.</li>
          </ul>
        </Secao>

        <Secao titulo="Problemas comuns">
          <ul>
            <li>
              <strong>“Ficha salva neste aparelho. Publicação pendente”</strong> — não havia rede ou a
              sessão estava vencida. Nada se perdeu: a fila sobe na próxima sincronização. Se insistir,
              entre na conta de novo.
            </li>
            <li>
              <strong>“Falta o número de série do núcleo”</strong> — na P2 os dois campos precisam
              estar preenchidos. Confira se o núcleo novo foi selecionado.
            </li>
            <li>
              <strong>Ficha sumiu da tela inicial</strong> — confira a aba (contator ou seccionadora),
              depois o Histórico. Rascunho abandonado expira em 5 dias.
            </li>
            <li>
              <strong>Aparelho novo sem dados</strong> — precisa de uma sincronização com rede para
              receber equipe, equipamentos e histórico.
            </li>
            <li>
              <strong>Não deixa concluir</strong> — a ficha está apontando o que falta preencher na
              identificação. O aviso leva direto para a aba do primeiro campo pendente.
            </li>
          </ul>
        </Secao>

        <p className="pt-2 text-center text-[11px] text-slate-500">
          Este manual é lido sem internet. Se algo aqui não bater com o app, avise o administrador —
          a regra muda no sistema e no manual.
        </p>
      </div>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-bold text-slate-900">{titulo}</h2>
      {/**
         * Sem `[&_strong]:text-slate-900` aqui: essa variante aplica a cor
         * escura direto no <strong>, e o tema escuro só sobrescreve quem tem a
         * classe — o negrito virava texto escuro em fundo escuro, os "buracos"
         * que apareciam no manual. O destaque agora vem da classe `manual`,
         * definida no CSS com a variável do tema.
         */}
      <div className="manual space-y-2 text-xs leading-relaxed text-slate-600 [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal">
        {children}
      </div>
    </section>
  )
}