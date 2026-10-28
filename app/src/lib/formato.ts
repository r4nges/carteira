// Formatadores pt-BR. Saída sempre com espaço comum (o Intl usa NBSP) e fuso
// America/Sao_Paulo, independentemente do fuso da máquina.

const FUSO = 'America/Sao_Paulo'
const MENOS = '−'
const VAZIO = '—'

function normalizar(texto: string): string {
  return texto.replace(/[  ]/g, ' ')
}

function numero(n: number, casas: number): string {
  return normalizar(
    new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(n),
  )
}

/** Sinal de menos só quando o valor arredondado não é zero. */
function comSinal(n: number, casas: number, montar: (abs: string) => string): string {
  const abs = numero(Math.abs(n), casas)
  const zero = Number(abs.replace(/\./g, '').replace(',', '.')) === 0
  return (n < 0 && !zero ? MENOS : '') + montar(abs)
}

/** `R$ 1.234,56`; negativo: `−R$ 12,30` (U+2212). */
export function moeda(n: number): string {
  if (!Number.isFinite(n)) return VAZIO
  return comSinal(n, 2, (abs) => `R$ ${abs}`)
}

/** `1.234,50`: pt-BR com `casas` fixas (padrão 2); sem sinal quando o arredondado é zero. */
export function decimal(n: number, casas = 2): string {
  if (!Number.isFinite(n)) return VAZIO
  return comSinal(n, casas, (abs) => abs)
}

const formatadorQuantidade = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
})

/** Quantidade só com as casas necessárias (até 8): `40`, `1.234,5`, `0,12345678`. */
export function quantidade(n: number): string {
  if (!Number.isFinite(n)) return VAZIO
  return normalizar(formatadorQuantidade.format(n === 0 ? 0 : n))
}

/** `1,2%`; negativo: `−1,2%` (U+2212). */
export function pct(n: number, casas = 1): string {
  if (!Number.isFinite(n)) return VAZIO
  return comSinal(n, casas, (abs) => `${abs}%`)
}

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** `dd/mm/aaaa` em São Paulo. Data pura (`aaaa-mm-dd`) não sofre deslocamento. */
export function dataBR(iso: string): string {
  const pura = SO_DATA.exec(iso)
  if (pura) return `${pura[3]}/${pura[2]}/${pura[1]}`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return VAZIO
  return normalizar(formatadorData.format(d))
}

/** `HH:MM` em São Paulo. */
export function horaBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return VAZIO
  return normalizar(formatadorHora.format(d))
}

const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Hoje em São Paulo como `aaaa-mm-dd` (não depende do fuso da máquina). */
export function hojeSP(agora: Date = new Date()): string {
  return formatadorDiaISO.format(agora)
}

/** "às 13:55" se for hoje; "26/10/2026 às 13:55" nos outros dias; null se a data não vale. */
export function quandoBR(iso: string | null | undefined, agora: Date): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hora = `às ${horaBR(iso)}`
  return hojeSP(d) === hojeSP(agora) ? hora : `${dataBR(iso)} ${hora}`
}

/** Acrescenta "+" a valores positivos (o "−" já vem dos formatadores). */
export function comMais(n: number, texto: string): string {
  return Number(n.toFixed(2)) > 0 ? `+${texto}` : texto
}

/** Classe de cor da variação: alta, baixa ou neutro (zero arredondado). */
export function classeSinal(n: number): 'alta' | 'baixa' | 'neutro' {
  const r = Number(n.toFixed(2))
  return r > 0 ? 'alta' : r < 0 ? 'baixa' : 'neutro'
}
