import { selo as calcularSelo, type Limites, type Selo as Situacao } from '../lib/metricas'

const CLASSE: Record<Situacao, string> = {
  Barato: 'barato',
  'No meio': 'meio',
  'Perto do teto': 'teto',
  Esticado: 'esticado',
}

interface Props {
  /** Posição na faixa de 52 semanas (0 a 100). */
  posicao: number | null | undefined
  limites: Limites
}

/** Situação pela posição na faixa de 52 semanas. O texto é o sinal; a cor só reforça. */
export function Selo({ posicao, limites }: Props) {
  const situacao = calcularSelo(posicao, limites)
  if (!situacao) return null
  return <span class={`selo selo--${CLASSE[situacao]}`}>{situacao}</span>
}
