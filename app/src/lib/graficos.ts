import {
  ArcElement,
  CategoryScale,
  Chart,
  type ChartConfiguration,
  type ChartType,
  DoughnutController,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

let registrado = false

/** Registra só o que a rosca e a linha usam (tree-shaking) e devolve o Chart. */
export function prepararChart(): typeof Chart {
  if (!registrado) {
    Chart.register(
      ArcElement,
      DoughnutController,
      LineController,
      LineElement,
      PointElement,
      CategoryScale,
      LinearScale,
      Tooltip,
      Filler,
    )
    registrado = true
  }
  return Chart
}

/** Lê um token de cor (`--cor-tinta`) do tema atual; `reserva` se o CSS não está disponível. */
export function cor(token: string, reserva: string): string {
  if (typeof document === 'undefined') return reserva
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return v || reserva
}

/**
 * Cria o gráfico; se o Chart.js falhar (configuração errada, canvas indisponível), registra o erro
 * no console e devolve null. A legenda e o resumo em texto continuam na tela.
 */
export function criarGrafico<T extends ChartType>(el: HTMLCanvasElement, config: ChartConfiguration<T>): Chart<T> | null {
  try {
    const Construtor = prepararChart()
    return new Construtor(el, config as unknown as ChartConfiguration) as unknown as Chart<T>
  } catch (erro) {
    console.error('Não foi possível desenhar o gráfico.', erro)
    return null
  }
}
