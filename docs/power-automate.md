# Power Automate — receber fichas do app e gravar no SharePoint

Sem App Registration, sem consentimento de administrador. Tudo roda com a **sua conta**.

---

## 1. Preparar o SharePoint

No site (o mesmo que você já usa), crie:

**Lista `FichasExecucoes`** — colunas (nome interno entre parênteses):

| Coluna | Tipo | Observação |
|---|---|---|
| Title | Texto de uma linha | vai receber o código (ex.: CT-20261111-001) |
| FichaId (FichaId) | Texto | CT-BI / CT-FICHA / SC-BI1 |
| FichaNome (FichaNome) | Texto | nome legível |
| TipoManutencao (TipoManutencao) | Escolha | P1 / P2 |
| Marca (Marca) | Escolha | Merlin Gerin / Schneider / (vazio) |
| Local (Local) | Texto | |
| DataHora (DataHora) | Data e hora | |
| ObservacaoGeral (ObservacaoGeral) | Texto multilinha | |
| NaoConformes (NaoConformes) | Número | quantos itens fora do limite |
| ArquivoOrigem (ArquivoOrigem) | Texto | nome do JSON processado |
| ExecucaoId (ExecucaoId) | Texto | chave de idempotência |

**Lista `FichasMedicoes`**:

| Coluna | Tipo |
|---|---|
| Title | Texto — nome do ponto de medição |
| ExecucaoCodigo (ExecucaoCodigo) | Texto |
| ItemId (ItemId) | Texto |
| Valor (Valor) | Texto |
| Unidade (Unidade) | Texto |
| Limite (Limite) | Texto |
| Resultado (Resultado) | Escolha: Conforme / Não conforme / N/A |
| Observacao (Observacao) | Texto multilinha |
| FotoUrl (FotoUrl) | Hiperlink |

**Biblioteca `FichasFotos`** — para os arquivos de imagem.

**Pasta no OneDrive:** `Fichas/Entrada`

---

## 2. Criar o fluxo

Power Automate → **Criar** → **Fluxo automatizado** → gatilho **"Quando um arquivo é criado (somente propriedades)"** → OneDrive for Business → pasta `Fichas/Entrada`.

> Use "somente propriedades". O conteúdo você lê depois com "Obter conteúdo do arquivo" — com arquivos pequenos é mais estável.

### Ação 1 — Obter conteúdo do arquivo
- Conexão: OneDrive
- Id do arquivo: `Id` do gatilho

### Ação 2 — Converter em JSON (Parse JSON)
- Conteúdo: `body('Obter_conteudo_do_arquivo')`
- Esquema: use **"Usar exemplo de payload"** e cole o arquivo `docs/exemplo-execucao.json` deste diretório. O Power Automate gera o schema sozinho.

### Ação 3 — Condição
`formato` **é igual a** `fichas-backup`

Se não for, adicione **Encerrar** com status `Failed` e mensagem "arquivo não é um backup das fichas".

### Ação 4 — Aplicar a cada (loop)
Entrada: `execucoes` (saída do Parse JSON)

**Dentro do loop:**

**4.1 — Verificar duplicidade (ação "Obter itens" do SharePoint)**
- Lista: `FichasExecucoes`
- Filtro de consulta:
```
ExecucaoId eq '@{items('Aplicar_a_cada')?['id']}'
```

**4.2 — Condição:** `length(body('Obter_itens')?['value'])` **é igual a** `0`

**Se sim (não existe):**

**a) Contar não conformes** — ação **Compose**:
```
@{length(where(items('Aplicar_a_cada')?['valores'], item()?['observacao'] != null))}
```
> Este número é aproximado; para o cálculo exato por limite, use o passo opcional ao fim deste guia.

**b) Criar item — FichasExecucoes:**
- Title: `@{items('Aplicar_a_cada')?['codigo']}`
- FichaId: `@{items('Aplicar_a_cada')?['fichaId']}`
- FichaNome: `@{items('Aplicar_a_cada')?['fichaNome']}`
- TipoManutencao: `@{items('Aplicar_a_cada')?['tipoManutencao']}`
- Marca: `@{items('Aplicar_a_cada')?['marca']}`
- Local: `@{items('Aplicar_a_cada')?['local']}`
- DataHora: `@{items('Aplicar_a_cada')?['dataHora']}`
- ObservacaoGeral: `@{items('Aplicar_a_cada')?['observacaoGeral']}`
- ArquivoOrigem: `@{triggerOutputs()?['body/Name']}`
- ExecucaoId: `@{items('Aplicar_a_cada')?['id']}`

**c) Aplicar a cada 2** — sobre `valores`:

**c.1 — Criar item — FichasMedicoes:**
- Title: `@{items('Aplicar_a_cada_2')?['itemNome']}`
- ExecucaoCodigo: `@{items('Aplicar_a_cada')?['codigo']}`
- ItemId: `@{items('Aplicar_a_cada_2')?['itemId']}`
- Valor: `@{items('Aplicar_a_cada_2')?['valor']}`
- Observacao: `@{items('Aplicar_a_cada_2')?['observacao']}`

**d) Aplicar a cada 3** — sobre `fotos`, com condição
`@{items('Aplicar_a_cada_3')?['execucaoId']}` **é igual a** `@{items('Aplicar_a_cada')?['id']}`

**d.1 — Criar arquivo (OneDrive/SharePoint):**
- Pasta: `Fichas/Fotos`
- Nome: `@{items('Aplicar_a_cada_3')?['id']}.jpg`
- Conteúdo: `base64ToBinary(items('Aplicar_a_cada_3')?['base64'])`

**d.2 — Criar link de compartilhamento** sobre o arquivo criado

**d.3 — Atualizar item** em `FichasMedicoes` (o criado em c.1) com `FotoUrl` = link

**Se não (já existe):** nada a fazer — isso garante idempotência. Reenviar o mesmo arquivo não duplica.

### Ação 5 — Mover arquivo para Processados
- De: `Fichas/Entrada`
- Para: `Fichas/Processados`

> Se algo falhar no meio, o arquivo fica em Entrada e você reprocessa depois.

---

## 3. Testar

1. No app: **Backup → Enviar para o SharePoint → escolher execução → Enviar**
2. Escolha **Salvar no OneDrive** → pasta `Fichas/Entrada`
3. Abra o histórico de execuções do fluxo no Power Automate
4. Confira os itens nas listas do SharePoint

**Teste de idempotência:** envie o mesmo arquivo duas vezes. A segunda execução deve terminar sem criar nada.

---

## 4. Cálculo exato de não conformes (opcional)

Se quiser o número correto no campo `NaoConformes`, inclua uma **Compose** dentro do loop antes do "Criar item":

```
@{length(
  filter(
    items('Aplicar_a_cada')?['valores'],
    and(
      not(equals(item()?['valor'], '')),
      not(equals(item()?['valor'], 'infinito'))
    )
  )
)}
```

Isso conta apenas medições preenchidas. Para aplicar os limites reais, o ideal é que o app envie o resultado já calculado — se quiser, eu adiciono o campo `resultado` em cada item do JSON e você fica com o SharePoint contendo o veredito pronto, sem fórmula no fluxo.

**Recomendo fazer isso.** É mais confiável deixar a regra no app (onde ela é testada) do que replicar limites numa expressão de fluxo.

---

## 5. Alertas (opcional)

Ao final do fluxo, adicione uma condição: se `NaoConformes` > 0, envie **e-mail/Teams** com o código, o local e a lista de pontos fora do limite. É o que transforma o registro em ação.
