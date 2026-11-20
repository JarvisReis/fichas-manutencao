-- ============================================================================
-- Fichas de Medição — esquema Supabase
-- Projeto: xmjrpyugrcwlehjqgcqx (Supabase Metrosp)
-- Autor: Jarvis, 2026-11-18
--
-- Princípios:
--   Fotos: decisão de 2026-11-18 — o app NÃO guarda fotos. Sem bucket,
--   sem tabela, sem coluna fotoId no banco.
--
--   1. O técnico trabalha OFFLINE. O IndexedDB do aparelho é a fonte de uso;
--      o Supabase é destino de sincronização. Offline não é exceção.
--   2. Toda linha sabe QUEM criou (user_id = auth.uid()), porque hoje o token
--      único compartilhado não registra autoria.
--   3. Nada de RLS permissivo: cada técnico lê o que é dele ou o que é da
--      equipe, conforme a função `meu_nivel()`.
--   4. Idempotência por `client_id`: o app pode reenviar a mesma execução
--      quantas vezes quiser (celular sem sinal reenvia) sem duplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Perfis: espelha auth.users e guarda RG, nível e ativo.
-- O RG é a identificação interna da empresa (R + 5/6 dígitos), única.
-- ---------------------------------------------------------------------------
create table if not exists public.perfis (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  rg          text not null,
  funcao      text,
  nivel       text not null default 'usuario' check (nivel in ('administrador', 'usuario')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- RG único por funcionário. Inativo continua ocupando o número: quem saiu não
-- devolve o RG para outra pessoa.
create unique index if not exists perfis_rg_unico on public.perfis (upper(rg));
create index if not exists perfis_ativo on public.perfis (ativo) where ativo;

-- ---------------------------------------------------------------------------
-- Equipamentos: define QUAL ficha se aplica a cada contator/seccionadora.
-- O modelo não é escolhido pelo técnico — vem daqui.
-- ---------------------------------------------------------------------------
create table if not exists public.equipamentos (
  id          text primary key,
  nome        text not null,
  ficha_id    text not null,
  local       text not null default '',
  marca       text,
  serie       text,
  observacao  text,
  -- núcleo HPB instalado hoje; a P2 atualiza este campo
  nucleo_instalado text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists equipamentos_ativo on public.equipamentos (ativo) where ativo;

-- ---------------------------------------------------------------------------
-- Execuções: a ficha preenchida.
--
-- `valores` guarda as medições como JSONB (array de {itemId, valor,
-- observacao}) em vez de uma tabela por medição. Motivo: a ficha muda de
-- itens com o tempo (acabamos de remover "Barramento 1 X Barramento 2"),
-- e ficha antiga precisa continuar legível mesmo que o item não exista mais
-- na definição atual. Guardar por item em tabela própria quebraria isso.
-- ---------------------------------------------------------------------------
create table if not exists public.execucoes (
  id              uuid primary key default gen_random_uuid(),
  -- id que o app gerou no aparelho; é a chave de idempotência do reenvio
  client_id       text not null unique,
  codigo          text not null,
  ficha_id        text not null,
  equipamento_id  text references public.equipamentos(id) on delete set null,
  equipamento     text not null default '',
  local           text not null default '',
  marca           text,
  tipo_manutencao text check (tipo_manutencao in ('P1', 'P2')),
  nucleo_instalado text,
  nucleo_retirado  text,
  data_hora       timestamptz not null,
  data_fim        timestamptz,
  valores         jsonb not null default '[]'::jsonb,
  observacao_geral text,
  nao_conformes   integer not null default 0,
  status          text not null default 'rascunho'
                  check (status in ('rascunho', 'concluida', 'pendente')),
  criada_por      uuid not null default auth.uid() references auth.users(id),
  -- RG dos dois executantes, como gravado na ficha de papel
  rg1             text,
  rg2             text,
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now()
);

create index if not exists execucoes_criada_por on public.execucoes (criada_por, data_hora desc);
create index if not exists execucoes_equipamento on public.execucoes (equipamento_id, data_hora desc);
create index if not exists execucoes_codigo on public.execucoes (codigo);

-- ---------------------------------------------------------------------------
-- Função auxiliar: nível do usuário logado.
-- `security definer` para poder ler `perfis` dentro das políticas sem
-- recursão (a própria tabela perfis tem RLS).
-- ---------------------------------------------------------------------------
create or replace function public.meu_nivel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nivel from public.perfis where user_id = auth.uid() and ativo
$$;

create or replace function public.sou_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis where user_id = auth.uid() and ativo)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.perfis       enable row level security;
alter table public.equipamentos enable row level security;
alter table public.execucoes    enable row level security;

-- perfis: cada um vê o próprio; administrador vê todos.
drop policy if exists perfis_leitura on public.perfis;
create policy perfis_leitura on public.perfis
  for select to authenticated
  using (user_id = auth.uid() or public.meu_nivel() = 'administrador');

-- Cada um edita só o próprio perfil, e não pode se promover a administrador.
drop policy if exists perfis_proprio_update on public.perfis;
create policy perfis_proprio_update on public.perfis
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and nivel = (select nivel from public.perfis where user_id = auth.uid()));

-- Só administrador cria/remove perfil.
drop policy if exists perfis_admin_insert on public.perfis;
create policy perfis_admin_insert on public.perfis
  for insert to authenticated
  with check (public.meu_nivel() = 'administrador');

drop policy if exists perfis_admin_delete on public.perfis;
create policy perfis_admin_delete on public.perfis
  for delete to authenticated
  using (public.meu_nivel() = 'administrador');

-- equipamentos: todos os ativos leem; só administrador mantém.
drop policy if exists equipamentos_leitura on public.equipamentos;
create policy equipamentos_leitura on public.equipamentos
  for select to authenticated
  using (public.sou_ativo());

drop policy if exists equipamentos_escrita on public.equipamentos;
create policy equipamentos_escrita on public.equipamentos
  for all to authenticated
  using (public.meu_nivel() = 'administrador')
  with check (public.meu_nivel() = 'administrador');

-- execucoes: o técnico vê as próprias; administrador vê todas.
drop policy if exists execucoes_leitura on public.execucoes;
create policy execucoes_leitura on public.execucoes
  for select to authenticated
  using (criada_por = auth.uid() or public.meu_nivel() = 'administrador');

-- Só o autor insere, e sempre em nome dele (não dá para forjar autoria).
drop policy if exists execucoes_insert on public.execucoes;
create policy execucoes_insert on public.execucoes
  for insert to authenticated
  with check (criada_por = auth.uid() and public.sou_ativo());

-- Autor edita a própria, ou administrador edita qualquer uma.
-- Rascunho é exclusão local; excluir de verdade é ação de administrador.
drop policy if exists execucoes_update on public.execucoes;
create policy execucoes_update on public.execucoes
  for update to authenticated
  using (criada_por = auth.uid() or public.meu_nivel() = 'administrador')
  with check (criada_por = auth.uid() or public.meu_nivel() = 'administrador');

drop policy if exists execucoes_delete on public.execucoes;
create policy execucoes_delete on public.execucoes
  for delete to authenticated
  using (public.meu_nivel() = 'administrador');

-- ---------------------------------------------------------------------------
-- Trigger: atualiza `atualizada_em` sozinho, para o sync saber o que mudou.
-- ---------------------------------------------------------------------------
-- `execucoes`/`equipamentos` usam `atualizada_em` (feminino); `perfis` usa
-- `atualizado_em`. Uma função só para cada nome — a versão antiga escrevia
-- `atualizada_em` em todo mundo e quebrava qualquer UPDATE em `perfis`.
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizada_em = now();
  return new;
end;
$$;

create or replace function public.tocar_atualizado_em_perfis()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists execucoes_tocar on public.execucoes;
create trigger execucoes_tocar
  before update on public.execucoes
  for each row execute function public.tocar_atualizado_em();

drop trigger if exists equipamentos_tocar on public.equipamentos;
create trigger equipamentos_tocar
  before update on public.equipamentos
  for each row execute function public.tocar_atualizado_em();

drop trigger if exists perfis_tocar on public.perfis;
create trigger perfis_tocar
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em_perfis();

-- ---------------------------------------------------------------------------
-- Pessoas: funcionário de campo SEM conta no app.
--
-- `perfis` exige `user_id` de `auth.users`, então quem é cadastrado com
-- e-mail em branco (entra na dupla, não loga) não cabia em lugar nenhum e
-- desaparecia no outro aparelho. Esta tabela guarda esse cadastro.
-- Regra: mesmo RG nos dois lugares -> vale `perfis` (cadastro vivo).
-- ---------------------------------------------------------------------------
create table if not exists public.pessoas (
  id            text primary key,
  nome          text not null,
  rg            text not null,
  funcao        text,
  email         text,
  nivel         text not null default 'usuario' check (nivel in ('administrador', 'usuario')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists pessoas_rg_unico on public.pessoas (upper(rg));

alter table public.pessoas enable row level security;

-- ---------------------------------------------------------------------------
-- CONFIGURAÇÕES DO SISTEMA (ajustes das fichas)
--
-- A ficha em campo é `padrão do código + ajuste`. O ajuste nascia no IndexedDB
-- de quem editava: o administrador revisava um limite de medição e os técnicos
-- continuavam medindo com o limite velho, sem aviso nenhum — a pior divergência
-- possível numa ficha de conformidade.
--
-- Chave-valor para não criar uma tabela por ajuste futuro (núcleo padrão,
-- texto de cabeçalho, etc.). Hoje só a chave 'fichas-ajustes' é usada.
--
-- RLS ligada e SEM policy de propósito: nem `anon` nem `authenticated` leem
-- isto direto. Quem lê e grava é o servidor de sync (service role), que aplica
-- a regra "só administrador publica".
-- ---------------------------------------------------------------------------
create table if not exists public.configuracoes (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.configuracoes enable row level security;

-- ---------------------------------------------------------------------------
-- IDENTIDADE DA FICHA É O CÓDIGO
--
-- `codigo` é "EQUIPAMENTO · data" — o que está escrito na ficha de papel. O
-- `client_id` nasce aleatório em cada aparelho, então o mesmo serviço feito em
-- dois aparelhos virava duas linhas e as duas conclusões brigavam. O servidor
-- passou a usar o código como chave (adotando o client_id do primeiro aparelho
-- que subiu); este índice é a garantia no banco, não só na aplicação.
-- ---------------------------------------------------------------------------
create unique index if not exists execucoes_codigo_unico on public.execucoes (upper(codigo));

-- ---------------------------------------------------------------------------
-- CAMPOS FIXOS E CABEÇALHO INTEIROS
--
-- O app guarda equipe (rg1..rg6), patrimônios dos instrumentos e a série do
-- núcleo retirado em `camposFixos`. Até o contrato v3 isso NÃO era enviado: só
-- o nome do equipamento subia, e as colunas soltas rg1/rg2 nunca eram
-- preenchidas. A ficha ficava completa no aparelho de quem preencheu e
-- incompleta em todos os outros.
-- ---------------------------------------------------------------------------
alter table public.execucoes add column if not exists campos_fixos jsonb not null default '{}'::jsonb;
alter table public.execucoes add column if not exists cabecalho jsonb not null default '{}'::jsonb;
alter table public.execucoes add column if not exists rg3 text;
alter table public.execucoes add column if not exists rg4 text;
alter table public.execucoes add column if not exists rg5 text;
alter table public.execucoes add column if not exists rg6 text;
