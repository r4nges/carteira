import type { Ativo, Cotacao, Tesouro } from './tipos'

export type Selo = 'Barato' | 'No meio' | 'Perto do teto' | 'Esticado'

export interface Limites {
  barato: number
  meio: number
  teto: number
}

export const LIMITES_PADRAO: Limites = { barato: 25, meio: 75, teto: 90 }

export interface ValorPosicao {
  valor: number
  /** true quando o valor vem da planilha por falta de preço utilizável. */
  estimado: boolean
}

export interface ResumoPatrimonio {
  total: number
  variacaoReais: number
  variacaoPct: number
  semCotacao: string[]
}

const MINUTO_MS = 60_000
/** Em pregão: coletor parado se `atualizado_em` passa disto (roda a cada 30 min; o Actions atrasa 5 a 20). */
const LIMITE_COLETA_PREGAO_MS = 70 * MINUTO_MS
/** Em pregão: dado de mercado velho se o `as_of` de hoje passa disto (já nasce com 15 a 30 min de atraso). */
const LIMITE_MERCADO_PREGAO_MS = 90 * MINUTO_MS
/** Depois deste horário (SP), um `as_of` de dia anterior deixa de ser "ainda não abriu". */
const LIMITE_DIA_ANTERIOR_MS = (10 * 60 + 45) * MINUTO_MS
const LIMITE_ABSOLUTO_MS = 3 * 24 * 60 * MINUTO_MS
/** America/Sao_Paulo é UTC−3 fixo (sem horário de verão desde 2019). */
const DESLOCAMENTO_BRT_MS = 3 * 60 * MINUTO_MS
const ABERTURA_MS = 10 * 60 * MINUTO_MS
const FECHAMENTO_MS = 18 * 60 * MINUTO_MS
const DIA_MS = 24 * 60 * MINUTO_MS

/** Arredonda a 2 casas para não acumular erro de ponto flutuante. Nunca devolve -0. */
function arredondar(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100
  return r === 0 ? 0 : r
}

function positivo(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function finito(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function daPlanilha(a: Ativo, estimado: boolean): ValorPosicao {
  return finito(a.valor_atualizado)
    ? { valor: arredondar(a.valor_atualizado), estimado }
    : { valor: 0, estimado: true }
}

export function valorPosicao(a: Ativo, c?: Cotacao, t?: Tesouro): ValorPosicao {
  if (a.tipo === 'Renda fixa') return daPlanilha(a, false)
  const preco = a.tipo === 'Tesouro Direto' ? t?.pu_venda : c?.preco
  if (positivo(preco) && finito(a.quantidade)) {
    return { valor: arredondar(a.quantidade * preco), estimado: false }
  }
  return daPlanilha(a, true)
}

export function patrimonio(
  ativos: Ativo[],
  cot: Record<string, Cotacao>,
  tes: Record<string, Tesouro>,
): ResumoPatrimonio {
  let total = 0
  let variacao = 0
  let base = 0
  const semCotacao: string[] = []

  for (const a of ativos) {
    const c = cot[a.codigo]
    const { valor, estimado } = valorPosicao(a, c, tes[a.codigo])
    total += valor
    if (estimado) semCotacao.push(a.codigo)

    if (
      a.tipo !== 'Renda fixa' &&
      a.tipo !== 'Tesouro Direto' &&
      finito(a.quantidade) &&
      positivo(c?.preco) &&
      positivo(c?.prev_close)
    ) {
      variacao += a.quantidade * (c.preco - c.prev_close)
      base += a.quantidade * c.prev_close
    }
  }

  const variacaoReais = arredondar(variacao)
  const variacaoPct = base > 0 ? (variacao / base) * 100 : 0
  return {
    total: arredondar(total),
    variacaoReais,
    variacaoPct: Number.isFinite(variacaoPct) ? variacaoPct : 0,
    semCotacao,
  }
}

export interface MovimentoDia {
  codigo: string
  /** Variação da posição no dia, em R$: quantidade × (preço − fechamento anterior). */
  reais: number
  /** Variação do dia: preço ÷ fechamento anterior − 1, em %. */
  pct: number
}

/**
 * Variação do dia por ativo de bolsa, do maior impacto em R$ (valor absoluto) para o menor.
 * Só entra quem tem quantidade, preço e fechamento anterior utilizáveis; renda fixa e Tesouro não.
 */
export function movimentosDoDia(ativos: Ativo[], cot: Record<string, Cotacao>): MovimentoDia[] {
  const lista: MovimentoDia[] = []
  for (const a of ativos) {
    if (a.tipo === 'Renda fixa' || a.tipo === 'Tesouro Direto') continue
    const c = cot[a.codigo]
    if (!finito(a.quantidade) || !positivo(c?.preco) || !positivo(c?.prev_close)) continue
    lista.push({
      codigo: a.codigo,
      reais: arredondar(a.quantidade * (c.preco - c.prev_close)),
      pct: (c.preco / c.prev_close - 1) * 100,
    })
  }
  return lista.sort((x, y) => Math.abs(y.reais) - Math.abs(x.reais) || x.codigo.localeCompare(y.codigo))
}

export function pesoPct(valor: number, total: number): number {
  if (!finito(valor) || !positivo(total)) return 0
  return (valor / total) * 100
}

/** Quanto falta (+) ou sobra (−) em R$ para o alvo; null sem alvo definido. */
export function diferencaAlvoReais(a: Ativo, valor: number, total: number): number | null {
  if (!finito(a.alvo_pct) || !finito(valor) || !finito(total)) return null
  return arredondar((a.alvo_pct / 100) * total - valor)
}

export function somaAlvos(ativos: Ativo[]): number {
  let soma = 0
  for (const a of ativos) if (finito(a.alvo_pct)) soma += a.alvo_pct
  return arredondar(soma)
}

export function selo(posicaoFaixa: number | null | undefined, l: Limites = LIMITES_PADRAO): Selo | null {
  if (!finito(posicaoFaixa)) return null
  if (posicaoFaixa <= l.barato) return 'Barato'
  if (posicaoFaixa <= l.meio) return 'No meio'
  if (posicaoFaixa <= l.teto) return 'Perto do teto'
  return 'Esticado'
}

/** Instante em ms; `undefined` se o carimbo falta e `NaN` se é ilegível. */
function instante(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  return new Date(iso).getTime()
}

function ilegivel(t: number | undefined): boolean {
  return t !== undefined && Number.isNaN(t)
}

/** Milissegundos desde 00:00 em São Paulo. */
function msDoDiaSP(t: number): number {
  return (((t - DESLOCAMENTO_BRT_MS) % DIA_MS) + DIA_MS) % DIA_MS
}

/** Número do dia em São Paulo (comparável entre instantes). */
function diaSP(t: number): number {
  return Math.floor((t - DESLOCAMENTO_BRT_MS) / DIA_MS)
}

/** Segunda a sexta, 10:00 a 18:00 (inclusive) em America/Sao_Paulo. */
function emPregao(agora: Date): boolean {
  const brt = agora.getTime() - DESLOCAMENTO_BRT_MS
  const diaSemana = new Date(brt).getUTCDay()
  if (diaSemana === 0 || diaSemana === 6) return false
  const ms = msDoDiaSP(agora.getTime())
  return ms >= ABERTURA_MS && ms <= FECHAMENTO_MS
}

/**
 * Carimbo de coleta (`atualizado_em`, ou o `as_of` do briefing, que é a hora da coleta) velho:
 * ausente, ilegível, com mais de 3 dias ou, em horário de pregão, com mais de 70 min
 * (o coletor roda a cada 30 min e o Actions atrasa; passar disso é coletor parado).
 */
export function coletaDefasada(iso: string | null | undefined, agora: Date): boolean {
  const t = instante(iso)
  if (t === undefined || Number.isNaN(t)) return true
  const idade = agora.getTime() - t
  if (idade > LIMITE_ABSOLUTO_MS) return true
  return emPregao(agora) && idade > LIMITE_COLETA_PREGAO_MS
}

/**
 * Cotação ausente, marcada como defasada pelo coletor, sem data, com mais de 3 dias ou,
 * em horário de pregão: coletor parado (`atualizado_em` com mais de 70 min) ou dado de mercado
 * velho (`as_of` de hoje com mais de 90 min; `as_of` de dia anterior depois das 10:45).
 * O `as_of` é a hora do mercado e já chega com 15 a 30 min de atraso, por isso o limite é folgado.
 * Não há calendário de feriados.
 */
export function estaDefasado(c: Cotacao | undefined, agora: Date): boolean {
  if (!c || c.defasado === true) return true
  const asOf = instante(c.as_of)
  const coleta = instante(c.atualizado_em)
  if (ilegivel(asOf) || ilegivel(coleta)) return true
  const referencia = asOf ?? coleta
  if (referencia === undefined) return true
  const agoraMs = agora.getTime()
  if (agoraMs - referencia > LIMITE_ABSOLUTO_MS) return true
  if (!emPregao(agora)) return false
  if (coleta !== undefined && agoraMs - coleta > LIMITE_COLETA_PREGAO_MS) return true
  if (asOf !== undefined) {
    if (diaSP(asOf) < diaSP(agoraMs)) return msDoDiaSP(agoraMs) > LIMITE_DIA_ANTERIOR_MS
    return agoraMs - asOf > LIMITE_MERCADO_PREGAO_MS
  }
  return false
}
