# Serviço de sincronização (fichas-sync)

Proxy Node.js que recebe as execuções do app **Fichas de Medição** e grava nas listas do
SharePoint via **Microsoft Graph** com credenciais de aplicativo — sem ninguém
logado, sem Power Automate.

- `POST /fichas` — recebe **uma** execução (formato `fichas-execucao`, v2) e
  cria um item em `FichasExecucoes`. Idempotente por `ExecucaoId`.
  Em P2, atualiza também `NucleoInstalado` do contator na lista `Contatores`.
- `GET /fichas?equipamento=<nome>` — devolve o núcleo instalado atual daquele
  contator (usado pelo app para a P1 somente-leitura vir de qualquer aparelho).
- `GET /saude` — valida credencial e acesso ao site.

## 1. Preparar o app no Entra ID

1. Entra ID → **Registros de aplicativo** → **Novo registro**
   - Nome: `Fichas Sync`
   - Contas: **somente este locatário**
   - Sem URI de redirecionamento
2. **Certificados e segredos** → novo segredo do cliente → copie o **valor** (aparece uma vez).
3. **Permissões de API** → Microsoft Graph → **Permissões de aplicativo** →
   `Sites.Selected` → **Conceder consentimento de administrador**.
4. Dê acesso ao site específico (PowerShell com `PnP.PowerShell` ou `m365`):

```powershell
Connect-MgGraph -Scopes "Sites.Selected.ReadWrite.All"
$site = Get-MgSite -SiteId "metrosp.sharepoint.com:/sites/Fichas"
New-MgSitePermission -SiteId $site.Id -Roles @("write") -GrantedToIdentities @(
  @{ Application = @{ Id = "<CLIENT_ID>"; DisplayName = "Fichas Sync" } }
)
```

> `Sites.Selected` + permissão concedida no site = o app só enxerga aquele site.
> Nunca dê `Sites.ReadWrite.All` para um token de aplicativo em servidor.

## 2. Criar as listas no SharePoint

Os CSVs prontos estão em `~/.openclaw/workspace/lists_contatores/`.

**`FichasExecucoes`** (novo, uma linha por ficha executada):

| Coluna | Tipo |
|---|---|
| Title | Texto — código (CT-20261111-001) |
| ExecucaoId | Texto — chave de idempotência |
| FichaId | Texto |
| FichaNome | Texto |
| Equipamento | Texto — deve casar com o Title da lista Contatores |
| TipoManutencao | Escolha: P1 / P2 |
| Marca | Texto |
| NucleoInstalado | Texto |
| NucleoRetirado | Texto |
| Local | Texto |
| DataHora | Data e hora |
| Status | Texto |
| ObservacaoGeral | Texto multilinha |
| NaoConformes | Número |
| MedicoesJson | Texto multilinha |
| FotosJson | Texto multilinha |
| Aparelho | Texto |

**`Contatores`** — precisa ter `Title` = nome do contator (ex.: `CT 02 — CD1`)
e `NucleoInstalado` (texto). É essa coluna que o servidor lê e atualiza.

## 3. Rodar o serviço

```bash
sudo tee /etc/fichas-sync.env >/dev/null <<'EOF'
TENANT_ID=...
CLIENT_ID=...
CLIENT_SECRET=...
SITE_HOST=metrosp.sharepoint.com
SITE_PATH=/sites/Fichas
LIST_EXECUCOES=FichasExecucoes
LIST_CONTATORES=Contatores
PORT=8787
SYNC_TOKEN=uma-senha-longa-para-o-app
EOF
sudo chmod 600 /etc/fichas-sync.env

# teste rápido
set -a; . /etc/fichas-sync.env; set +a
node projects/fichas-metro/server/sync-server.mjs
curl -s localhost:8787/saude
```

Serviço systemd (fica de pé após reboot):

```bash
sudo tee /etc/systemd/system/fichas-sync.service >/dev/null <<'EOF'
[Unit]
Description=Fichas Metro sync (SharePoint)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/fichas-sync.env
ExecStart=/usr/bin/node /home/ricardo/.openclaw/workspace/projects/fichas-metro/server/sync-server.mjs
Restart=always
RestartSec=5
User=ricardo

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now fichas-sync
journalctl -u fichas-sync -f
```

## 3b. Serviço de administração (cadastros com senha)

O sync aceita execuções de qualquer aparelho com o token da equipe. **Cadastros
(pessoas/equipamentos) e exclusão de execução só passam pelo `admin-server.mjs`**,
que exige a senha de administrador. Assim, aparelho comprometido não altera a
equipe nem apaga histórico no SharePoint.

**Lista `ConfigFichas`** (uma linha só, criada uma vez):

| Coluna | Tipo |
|---|---|
| Title | Texto — sempre `config` |
| CadastrosVersao | Número |
| PessoasJson | Texto multilinha |
| EquipamentosJson | Texto multilinha |
| AlteradoEm | Texto (ISO) |

Rotas (todas com `Authorization: Bearer <ADMIN_PASSWORD>`):

| Rota | Efeito |
|---|---|
| `GET /admin/estado` | `{ admin, versao, pessoas, equipamentos }` |
| `POST /admin/pessoas` | `{ pessoas: [...] }` → nova versão |
| `POST /admin/equipamentos` | `{ equipamentos: [...] }` → nova versão |
| `POST /admin/execucoes/:id/excluir` | apaga a linha da execução |

Adicione ao `/etc/fichas-sync.env`:

```bash
ADMIN_PASSWORD=uma-senha-longa-do-administrador   # mínimo 8 caracteres
ADMIN_PORT=8788
LIST_CONFIG=ConfigFichas
```

Mesmo arquivo de ambiente, segundo serviço:

```bash
sudo tee /etc/systemd/system/fichas-admin.service >/dev/null <<'EOF'
[Unit]
Description=Fichas Metro admin (cadastros)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/fichas-sync.env
ExecStart=/usr/bin/node /home/ricardo/.openclaw/workspace/projects/fichas-metro/server/admin-server.mjs
Restart=always
RestartSec=5
User=ricardo

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now fichas-admin
```

`admin-server.mjs` recusa subir sem `ADMIN_PASSWORD` de 8+ caracteres e bloqueia
o IP por 10 minutos após 10 senhas erradas — o Raspberry não é um site público,
mas também não vale deixar força bruta aberta.

> A senha **não** substitui o nível no app: o RG escolhe quem é administrador na
> tela; a `ADMIN_PASSWORD` é o que autentica o aparelho junto ao SharePoint.

## 4. Apontar o app

No app, tela **Backup → Sincronização**, cole o endereço, ex.:

```
https://<seu-host-ou-tailscale>:8787/fichas
```

Ou fixe no build: `VITE_SYNC_URL=https://host:8787/fichas npm run build`.

O endereço do serviço de administração é derivado do de sync
(`:8787/fichas` → `:8788`). Se preferir separar, grave
`localStorage['fichas:adminUrl']` ou compile com `VITE_ADMIN_URL`.

No **Backup → Sincronização** também cabe o token da equipe e a senha de
administrador: sem eles, o cadastro é salvo só no aparelho e o app avisa.

Sem endereço configurado, o app continua funcionando no modo antigo
(compartilhar arquivo JSON → Power Automate).

## 5. Testar ponta a ponta

1. `curl -s localhost:8787/saude` → `{"ok":true,...}`
2. No app: concluir uma execução → **Backup → Enviar pendentes**.
3. Conferir a linha em `FichasExecucoes` (código, tipo, núcleo, não conformes).
4. Enviar de novo a mesma execução → resposta `{"ok":true,"criado":false}` e
   nenhuma linha duplicada.
5. Fazer uma **P2** com núcleo novo → conferir que `NucleoInstalado` da lista
   `Contatores` mudou.
6. Em outro celular, abrir P1 do mesmo contator → o núcleo instalado deve vir do
   servidor.

## 6. Segurança

- `SYNC_TOKEN` exige `Authorization: Bearer <token>`; o app envia esse valor
  quando configurado (veja `src/lib/sync.ts`).
- Exponha o serviço por Tailscale/VPN ou HTTPS com certificado válido. Não deixe
  aberto na internet sem TLS.
- O segredo do cliente fica só em `/etc/fichas-sync.env` (chmod 600), nunca no app.
- `SYNC_TOKEN` protege o envio de execuções; `ADMIN_PASSWORD` protege os
  cadastros e a exclusão. São credenciais diferentes de propósito: o token da
  equipe vaza fácil (está em cada celular), a senha de administrador não.
- Sem senha de administrador no aparelho, a tela de Cadastros grava local mas
  **avisa** que não publicou — nada fica escondido do usuário.
