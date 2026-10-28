-- Esquema inicial do app de carteira.
-- Todas as tabelas têm RLS ligada; só o dono (uid na tabela dono) acessa os dados.
-- O coletor usa a chave service_role, que ignora RLS.
--
-- Pós-instalação (manual):
--   1. Desativar o cadastro público em Supabase Auth (Sign In / Providers:
--      "Allow new users to sign up" desligado). A RLS já barra quem não é o
--      dono, mas não há motivo para deixar contas estranhas serem criadas.
--   2. Criar o usuário dono em Auth e registrar o uid dele:
--        insert into dono (uid) values ('<uid>');
--      Sem essa linha ninguém (além do service_role) enxerga nada.
--
-- Pode ser reexecutada: tabelas com if not exists, função com or replace,
-- políticas recriadas com drop policy if exists.

create table if not exists dono (
  uid uuid primary key
);

create table if not exists ativos (
  codigo text primary key,
  tipo text check (tipo in ('FII', 'Ação', 'ETF', 'BDR', 'Tesouro Direto', 'Renda fixa')),
  produto text,
  quantidade numeric,
  valor_atualizado numeric,
  preco_fechamento numeric,
  vencimento text,
  tesouro_tipo text,
  alvo_pct numeric,
  atualizado_em timestamptz default now()
);

create table if not exists importacoes (
  id bigserial primary key,
  data_posicao date,
  importado_em timestamptz default now(),
  arquivo text,
  ativos jsonb
);

create table if not exists cotacoes (
  codigo text primary key,
  preco numeric,
  preco_fonte text,
  as_of timestamptz,
  defasado boolean,
  variacao_dia_pct numeric,
  prev_close numeric,
  faixa52_min numeric,
  faixa52_max numeric,
  posicao_faixa52_pct numeric,
  pvp numeric,
  vpa numeric,
  pl numeric,
  dy_12m_pct numeric,
  ultimo_rendimento jsonb,
  proventos_12m numeric,
  verificacao jsonb,
  avisos jsonb,
  erro text,
  atualizado_em timestamptz default now()
);

create table if not exists tesouro (
  codigo text primary key,
  data_base date,
  taxa_compra numeric,
  taxa_venda numeric,
  pu_compra numeric,
  pu_venda numeric,
  atualizado_em timestamptz default now()
);

-- chaves: indices, macro, briefing_mercado
create table if not exists indicadores (
  chave text primary key,
  valor jsonb,
  atualizado_em timestamptz default now()
);

create table if not exists snapshots (
  data date primary key,
  patrimonio numeric,
  posicoes jsonb
);

create table if not exists noticias (
  id text primary key,
  titulo text,
  lide text,
  fonte text,
  tema text,
  url text,
  publicado_em timestamptz,
  ativos text[],
  tags text[],
  grupo_id text,
  tambem_em text[],
  score numeric,
  coletado_em timestamptz default now()
);

-- chaves: limites_selo ({"barato":25,"meio":75,"teto":90}), alvos_guardados ({codigo: pct})
create table if not exists configuracoes (
  chave text primary key,
  valor jsonb
);

-- true se o usuário logado é o dono. security definer para ler dono sem
-- depender da política da própria tabela.
create or replace function eh_dono() returns boolean
  language sql security definer stable
  set search_path = public
  as $$ select exists(select 1 from dono where uid = auth.uid()) $$;

alter table dono enable row level security;
alter table ativos enable row level security;
alter table importacoes enable row level security;
alter table cotacoes enable row level security;
alter table tesouro enable row level security;
alter table indicadores enable row level security;
alter table snapshots enable row level security;
alter table noticias enable row level security;
alter table configuracoes enable row level security;

-- Remove a política antiga (using true) de versões anteriores desta migração.
drop policy if exists "autenticado acessa tudo" on ativos;
drop policy if exists "autenticado acessa tudo" on importacoes;
drop policy if exists "autenticado acessa tudo" on cotacoes;
drop policy if exists "autenticado acessa tudo" on tesouro;
drop policy if exists "autenticado acessa tudo" on indicadores;
drop policy if exists "autenticado acessa tudo" on snapshots;
drop policy if exists "autenticado acessa tudo" on noticias;
drop policy if exists "autenticado acessa tudo" on configuracoes;

-- dono: cada usuário só enxerga a própria linha.
drop policy if exists "dono le a si mesmo" on dono;
create policy "dono le a si mesmo" on dono
  for select to authenticated using (uid = auth.uid());

-- Escrita pelo app: só o dono.
drop policy if exists "dono acessa tudo" on ativos;
create policy "dono acessa tudo" on ativos
  for all to authenticated using (eh_dono()) with check (eh_dono());
drop policy if exists "dono acessa tudo" on importacoes;
create policy "dono acessa tudo" on importacoes
  for all to authenticated using (eh_dono()) with check (eh_dono());
drop policy if exists "dono acessa tudo" on configuracoes;
create policy "dono acessa tudo" on configuracoes
  for all to authenticated using (eh_dono()) with check (eh_dono());

-- Somente leitura pelo app (o coletor escreve com service_role).
drop policy if exists "dono le" on cotacoes;
create policy "dono le" on cotacoes
  for select to authenticated using (eh_dono());
drop policy if exists "dono le" on tesouro;
create policy "dono le" on tesouro
  for select to authenticated using (eh_dono());
drop policy if exists "dono le" on indicadores;
create policy "dono le" on indicadores
  for select to authenticated using (eh_dono());
drop policy if exists "dono le" on snapshots;
create policy "dono le" on snapshots
  for select to authenticated using (eh_dono());
drop policy if exists "dono le" on noticias;
create policy "dono le" on noticias
  for select to authenticated using (eh_dono());
