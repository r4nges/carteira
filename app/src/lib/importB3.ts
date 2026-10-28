import * as XLSX from 'xlsx'
import type { AtivoImportado } from './importacao'
import type { Ativo } from './tipos'

// Leitura da planilha "Posição" exportada pela B3 (lógica portada do artefato
// original). Só lê os campos da whitelist de AtivoImportado: colunas de CPF,
// CNPJ, conta e instituição nunca são consultadas.

type Celula = unknown
type Linha = Celula[]

/** Minúsculas, sem acento e com espaços colapsados: "Código  de Negociação" -> "codigo de negociacao". */
function norm(valor: Celula): string {
  if (valor == null) return ''
  return String(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function texto(valor: Celula): string {
  return valor == null ? '' : String(valor).trim()
}

const NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)$/

/** Aceita número puro ou texto pt-BR ("R$ 1.234,56"). Qualquer outra coisa vira null. */
function num(valor: Celula): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null
  let s = valor.replace(/R\$|\s/g, '')
  if (!s || s === '-') return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!NUMERO.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Primeiro valor numérico entre as colunas indicadas. */
function primeiro(linha: Linha, indices: number[]): number | null {
  for (const i of indices) {
    const n = num(linha[i])
    if (n != null) return n
  }
  return null
}

function indicesDe(cabecalho: string[], nomes: string[]): number[] {
  const out: number[] = []
  for (const nome of nomes) {
    const i = cabecalho.indexOf(nome)
    if (i >= 0) out.push(i)
  }
  return out
}

function indiceDe(cabecalho: string[], nomes: string[]): number {
  return cabecalho.findIndex((h) => nomes.includes(h))
}

/** Tipo do ativo pelo nome da aba; aba desconhecida fica sem tipo. */
function tipoDaAba(nome: string): Ativo['tipo'] {
  const n = norm(nome)
  if (n.includes('tesouro')) return 'Tesouro Direto'
  if (n.includes('etf')) return 'ETF'
  if (n.includes('bdr')) return 'BDR'
  if (n.includes('renda fixa')) return 'Renda fixa'
  if (n.includes('fundo') || /\bfiis?\b/.test(n)) return 'FII'
  if (n.includes('acao') || n.includes('acoes')) return 'Ação'
  return null
}

const NOME_TESOURO = /^tesouro\b/
const ANO_FINAL = /\s+\d{4}$/

/** "Tesouro Prefixado 2032" -> "Tesouro Prefixado". Devolve null se não for Tesouro. */
export function tesouroTipo(produto: string): string | null {
  const limpo = produto.replace(/\s+/g, ' ').trim()
  if (!NOME_TESOURO.test(norm(limpo))) return null
  return limpo.replace(ANO_FINAL, '').trim()
}

function codigoTesouro(produto: string): string {
  const base = norm(produto).toUpperCase()
  if (base.includes('SELIC')) return 'TESOURO_SELIC'
  return base.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

const TICKER = /\b[A-Z]{4}\d{1,2}[A-Z]?\b/
const LINHA_TOTAL = /^total(\s|:|$)/

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0')
}

function dataBR(d: Date): string {
  return `${doisDigitos(d.getUTCDate())}/${doisDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/** Vencimento como texto dd/mm/aaaa; aceita serial do Excel e Date. */
function vencimentoDe(valor: Celula): string | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : dataBR(valor)
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null
    if (valor > 20000 && valor < 80000) {
      return dataBR(new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86_400_000))
    }
    return String(valor)
  }
  const s = texto(valor)
  return s && s !== '-' ? s.slice(0, 20) : null
}

function linhasDaAba(wb: XLSX.WorkBook, aba: string): Linha[] {
  const folha = wb.Sheets?.[aba]
  if (!folha) return []
  try {
    return XLSX.utils.sheet_to_json<Linha>(folha, { header: 1, raw: true, defval: '' })
  } catch {
    return []
  }
}

/** Soma quantidade e valor do mesmo código (mesmo ativo em duas corretoras). */
function somarDuplicados(lidos: AtivoImportado[]): AtivoImportado[] {
  const porCodigo = new Map<string, AtivoImportado>()
  for (const a of lidos) {
    const o = porCodigo.get(a.codigo)
    if (!o) {
      porCodigo.set(a.codigo, { ...a })
      continue
    }
    o.quantidade += a.quantidade
    if (a.valor_atualizado != null) o.valor_atualizado = (o.valor_atualizado ?? 0) + a.valor_atualizado
    o.preco_fechamento ??= a.preco_fechamento
    o.vencimento ??= a.vencimento
  }
  return [...porCodigo.values()]
}

/**
 * Lê as abas de posição. Extrato de Movimentação (cabeçalho com Entrada/Saída)
 * é recusado: `ehMovimentacao: true` e nenhum ativo.
 */
export function lerPlanilha(wb: XLSX.WorkBook): { ativos: AtivoImportado[]; ehMovimentacao: boolean } {
  const lidos: AtivoImportado[] = []
  let ehMovimentacao = false

  for (const aba of wb.SheetNames ?? []) {
    const linhas = linhasDaAba(wb, aba)
    const iCab = linhas.findIndex((l) => Array.isArray(l) && l.some((c) => norm(c) === 'quantidade'))
    if (iCab < 0) continue

    const cab = linhas[iCab].map(norm)
    if (cab.includes('entrada/saida') || cab.includes('movimentacao')) {
      ehMovimentacao = true
      continue
    }

    const tipo = tipoDaAba(aba)
    const cCod = indiceDe(cab, ['codigo de negociacao', 'codigo'])
    const cProd = indiceDe(cab, ['produto'])
    const cQtd = indiceDe(cab, ['quantidade'])
    const cPreco = indicesDe(cab, [
      'preco de fechamento',
      'preco',
      'preco atualizado fechamento',
      'preco atualizado curva',
      'preco atualizado mtm',
    ])
    const cValor = indicesDe(cab, [
      'valor atualizado',
      'valor atualizado fechamento',
      'valor atualizado curva',
      'valor atualizado mtm',
      'valor liquido',
      'valor bruto',
    ])
    const cVenc = indiceDe(cab, ['vencimento'])

    for (const linha of linhas.slice(iCab + 1)) {
      if (!Array.isArray(linha)) continue
      const quantidade = num(linha[cQtd])
      if (quantidade == null || quantidade <= 0) continue

      const produto = cProd >= 0 ? texto(linha[cProd]) : ''
      const codigoCelula = cCod >= 0 ? texto(linha[cCod]).toUpperCase() : ''
      if (LINHA_TOTAL.test(norm(produto)) || LINHA_TOTAL.test(norm(codigoCelula))) continue

      let codigo = codigoCelula
      if (!codigo) codigo = TICKER.exec(produto.toUpperCase())?.[0] ?? ''
      if (tipo === 'Tesouro Direto' && produto) codigo = codigoTesouro(produto)
      if (!codigo) continue

      lidos.push({
        codigo,
        tipo,
        produto: produto.slice(0, 80),
        quantidade,
        preco_fechamento: primeiro(linha, cPreco),
        valor_atualizado: primeiro(linha, cValor),
        vencimento: cVenc >= 0 ? vencimentoDe(linha[cVenc]) : null,
        tesouro_tipo: tipo === 'Tesouro Direto' ? tesouroTipo(produto) : null,
      })
    }
  }

  if (ehMovimentacao) return { ativos: [], ehMovimentacao: true }
  return { ativos: somarDuplicados(lidos), ehMovimentacao: false }
}
