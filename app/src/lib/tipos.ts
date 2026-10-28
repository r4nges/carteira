// Espelho de supabase/migrations/0001_init.sql.
// Colunas sem "not null" no esquema chegam como null quando vazias.
// numeric -> number; timestamptz e date -> string ISO; jsonb -> Json.

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [chave: string]: Json }

export type Rota = 'inicio' | 'ativos' | 'proventos' | 'importar' | 'config'

export type TipoAtivo =
  | 'FII'
  | 'Ação'
  | 'ETF'
  | 'BDR'
  | 'Tesouro Direto'
  | 'Renda fixa'

/** Tabela `ativos`. */
export interface Ativo {
  codigo: string
  tipo: TipoAtivo | null
  produto: string | null
  quantidade: number | null
  valor_atualizado: number | null
  preco_fechamento: number | null
  vencimento: string | null
  tesouro_tipo: string | null
  alvo_pct: number | null
  atualizado_em: string | null
}

/** Tabela `importacoes`. */
export interface Importacao {
  id: number
  data_posicao: string | null
  importado_em: string | null
  arquivo: string | null
  ativos: Json | null
}

/** Tabela `cotacoes`. */
export interface Cotacao {
  codigo: string
  preco: number | null
  preco_fonte: string | null
  as_of: string | null
  defasado: boolean | null
  variacao_dia_pct: number | null
  prev_close: number | null
  faixa52_min: number | null
  faixa52_max: number | null
  posicao_faixa52_pct: number | null
  pvp: number | null
  vpa: number | null
  pl: number | null
  dy_12m_pct: number | null
  ultimo_rendimento: Json | null
  proventos_12m: number | null
  verificacao: Json | null
  avisos: Json | null
  erro: string | null
  atualizado_em: string | null
}

/** Tabela `tesouro`. */
export interface Tesouro {
  codigo: string
  data_base: string | null
  taxa_compra: number | null
  taxa_venda: number | null
  pu_compra: number | null
  pu_venda: number | null
  atualizado_em: string | null
}

/** Tabela `indicadores` (chaves: indices, macro, briefing_mercado). */
export interface Indicador {
  chave: string
  valor: Json | null
  atualizado_em: string | null
}

/** Tabela `snapshots`: um registro por dia no fechamento. */
export interface Snapshot {
  data: string
  patrimonio: number | null
  posicoes: Json | null
}

/** Tabela `noticias`. */
export interface Noticia {
  id: string
  titulo: string | null
  lide: string | null
  fonte: string | null
  tema: string | null
  url: string | null
  publicado_em: string | null
  ativos: string[] | null
  tags: string[] | null
  grupo_id: string | null
  tambem_em: string[] | null
  score: number | null
  coletado_em: string | null
}

/** Tabela `configuracoes` (chave/valor). */
export interface ConfiguracaoLinha {
  chave: string
  valor: Json | null
}

/** Valor da chave `limites_selo` em `configuracoes`. */
export interface LimitesSelo {
  barato: number
  meio: number
  teto: number
}

/** Valor da chave `alvos_guardados` em `configuracoes`: {codigo: pct}. */
export type AlvosGuardados = Record<string, number>

/** Configurações já lidas e com padrão aplicado (ver `carregarTudo`). */
export interface Configuracoes {
  limites: LimitesSelo
  alvosGuardados: AlvosGuardados
}
