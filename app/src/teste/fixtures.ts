import type { DadosCarteira } from '../lib/banco'
import { LIMITES_PADRAO } from '../lib/metricas'
import type { Ativo, Cotacao, Noticia, Tesouro } from '../lib/tipos'

// Dados fictícios (códigos e números arbitrários) para os testes de tela.

export function ativo(p: Partial<Ativo> = {}): Ativo {
  return {
    codigo: 'FIIA11',
    tipo: 'FII',
    produto: null,
    quantidade: 7,
    valor_atualizado: 600,
    preco_fechamento: null,
    vencimento: null,
    tesouro_tipo: null,
    alvo_pct: null,
    atualizado_em: null,
    ...p,
  }
}

export function cotacao(p: Partial<Cotacao> = {}): Cotacao {
  return {
    codigo: 'FIIA11',
    preco: 87.35,
    preco_fonte: null,
    as_of: null,
    defasado: null,
    variacao_dia_pct: null,
    prev_close: null,
    faixa52_min: null,
    faixa52_max: null,
    posicao_faixa52_pct: null,
    pvp: null,
    vpa: null,
    pl: null,
    dy_12m_pct: null,
    ultimo_rendimento: null,
    proventos_12m: null,
    verificacao: null,
    avisos: null,
    erro: null,
    atualizado_em: null,
    ...p,
  }
}

export function tesouro(p: Partial<Tesouro> = {}): Tesouro {
  return {
    codigo: 'TESA',
    data_base: null,
    taxa_compra: null,
    taxa_venda: null,
    pu_compra: null,
    pu_venda: null,
    atualizado_em: null,
    ...p,
  }
}

export function noticia(p: Partial<Noticia> = {}): Noticia {
  return {
    id: 'n1',
    titulo: 'Título de teste',
    lide: null,
    fonte: 'Veículo A',
    tema: 'economia',
    url: 'https://exemplo.com.br/materia',
    publicado_em: null,
    ativos: null,
    tags: null,
    grupo_id: null,
    tambem_em: null,
    score: 0.5,
    coletado_em: null,
    ...p,
  }
}

export function dadosCarteira(p: Partial<DadosCarteira> = {}): DadosCarteira {
  return {
    ativos: [],
    cotacoes: {},
    tesouros: {},
    snapshots: [],
    noticias: [],
    indicadores: {},
    config: { limites: { ...LIMITES_PADRAO }, alvosGuardados: {} },
    ...p,
  }
}
