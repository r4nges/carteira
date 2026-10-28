import { dataBR, horaBR } from '../lib/formato'
import { estaDefasado } from '../lib/metricas'
import type { Ativo, Cotacao } from '../lib/tipos'

interface Props {
  ativos: Ativo[]
  cotacoes: Record<string, Cotacao>
  agora?: Date
}

/** Tesouro e renda fixa não têm cotação de bolsa. */
export function temCotacaoDeBolsa(a: Ativo): boolean {
  return a.tipo !== 'Tesouro Direto' && a.tipo !== 'Renda fixa'
}

function marcaDe(c: Cotacao | undefined): number | null {
  const marca = c?.as_of ?? c?.atualizado_em
  if (!marca) return null
  const t = new Date(marca).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Aviso no alto da tela quando alguma cotação de bolsa está velha (coletor parado ou
 * dado de mercado velho no pregão, mais de 3 dias, marcada pelo coletor ou ausente;
 * as regras estão em `estaDefasado`).
 * Mostra a atualização mais recente que existe, sem inventar hora.
 */
export function BannerDefasado({ ativos, cotacoes, agora = new Date() }: Props) {
  const deBolsa = ativos.filter(temCotacaoDeBolsa)
  const velhas = deBolsa.filter((a) => estaDefasado(cotacoes[a.codigo], agora))
  if (velhas.length === 0) return null

  let maisRecente: number | null = null
  for (const a of deBolsa) {
    const t = marcaDe(cotacoes[a.codigo])
    if (t !== null && (maisRecente === null || t > maisRecente)) maisRecente = t
  }

  const quais =
    velhas.length === 1 && deBolsa.length === 1
      ? 'A cotação está desatualizada.'
      : `${velhas.length} de ${deBolsa.length} ativos estão com cotação desatualizada.`

  return (
    <p class="mensagem mensagem--aviso banner" role="status">
      {quais}{' '}
      {maisRecente === null
        ? 'Não há cotação com data disponível.'
        : `Cotação mais recente: ${dataBR(new Date(maisRecente).toISOString())} às ${horaBR(new Date(maisRecente).toISOString())}.`}
    </p>
  )
}
