import { decimal, moeda } from '../lib/formato'

interface Props {
  /** Posição do preço entre a mínima (0) e a máxima (100) de 52 semanas. */
  posicao: number | null | undefined
  min?: number | null
  max?: number | null
}

function finito(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Barra de 52 semanas com marcador e os extremos escritos embaixo. */
export function BarraFaixa({ posicao, min, max }: Props) {
  if (!finito(posicao)) {
    return <span class="faixa faixa--vazia">sem faixa de 52 semanas</span>
  }
  const marcador = Math.min(100, Math.max(0, posicao))
  const temExtremos = finito(min) && finito(max)
  let descricao = `posição na faixa de 52 semanas: ${Math.round(posicao)}%`
  if (temExtremos) descricao += `, mínima ${moeda(min)}, máxima ${moeda(max)}`

  return (
    <span class="faixa">
      <span class="faixa__barra" role="img" aria-label={descricao}>
        <span class="faixa__marcador" style={{ left: `${marcador}%` }} />
      </span>
      {temExtremos && (
        <span class="faixa__extremos num" aria-hidden="true">
          <span>{decimal(min)}</span>
          <span>{decimal(max)}</span>
        </span>
      )}
    </span>
  )
}
