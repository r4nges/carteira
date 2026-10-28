import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { comMais, dataBR, hojeSP, moeda, pct } from '../lib/formato'
import { cor, criarGrafico } from '../lib/graficos'
import type { Snapshot } from '../lib/tipos'
import { useMidia } from '../lib/useMidia'

export type Periodo = '1S' | '1M' | '3M' | '1A' | 'Tudo'

export const PERIODOS: { periodo: Periodo; dias: number | null; nome: string }[] = [
  { periodo: '1S', dias: 7, nome: 'última semana' },
  { periodo: '1M', dias: 30, nome: 'último mês' },
  { periodo: '3M', dias: 90, nome: 'últimos 3 meses' },
  { periodo: '1A', dias: 365, nome: 'último ano' },
  { periodo: 'Tudo', dias: null, nome: 'todo o histórico' },
]

export interface Ponto {
  /** aaaa-mm-dd */
  data: string
  patrimonio: number
}

/** Snapshots com data e patrimônio válidos, em ordem crescente de data. */
export function pontosValidos(snapshots: Snapshot[]): Ponto[] {
  const pontos: Ponto[] = []
  for (const s of snapshots) {
    const data = typeof s.data === 'string' ? s.data.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue
    if (typeof s.patrimonio !== 'number' || !Number.isFinite(s.patrimonio)) continue
    pontos.push({ data, patrimonio: s.patrimonio })
  }
  return pontos.sort((a, b) => a.data.localeCompare(b.data))
}

function menosDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10)
}

/**
 * Pontos do período: de (hoje − N dias) em diante, datas em São Paulo. 1S = 7 dias, 1M = 30,
 * 3M = 90, 1A = 365; "Tudo" não corta. O dia de N dias atrás entra, para a semana ter base de comparação.
 */
export function filtrarPontos(pontos: Ponto[], periodo: Periodo, hoje: string): Ponto[] {
  const dias = PERIODOS.find((p) => p.periodo === periodo)?.dias ?? null
  if (dias === null) return pontos
  const corte = menosDias(hoje, dias)
  return pontos.filter((p) => p.data >= corte)
}

/** Resumo em texto da curva: período, valores inicial e final e a variação. */
export function resumirEvolucao(pontos: Ponto[]): string {
  const primeiro = pontos[0]
  const ultimo = pontos[pontos.length - 1]
  const reais = ultimo.patrimonio - primeiro.patrimonio
  const partes = [comMais(reais, moeda(reais))]
  if (primeiro.patrimonio > 0) {
    const p = (reais / primeiro.patrimonio) * 100
    partes.push(comMais(p, pct(p)))
  }
  return `Fechamentos de ${dataBR(primeiro.data)} a ${dataBR(ultimo.data)}: de ${moeda(primeiro.patrimonio)} para ${moeda(ultimo.patrimonio)} (${partes.join(', ')}).`
}

function moedaCurta(v: number): string {
  return moeda(v).replace(/,00$/, '')
}

function Linha({ pontos, descricao }: { pontos: Ponto[]; descricao: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const escuro = useMidia('(prefers-color-scheme: dark)')

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const destaque = cor('--cor-destaque', '#1d4f73')
    const suave = cor('--cor-tinta-suave', '#56625d')
    const linha = cor('--cor-linha', '#dde3e0')
    const grafico = criarGrafico(el, {
      type: 'line',
      data: {
        labels: pontos.map((p) => dataBR(p.data)),
        datasets: [
          {
            data: pontos.map((p) => p.patrimonio),
            borderColor: destaque,
            backgroundColor: cor('--cor-destaque-fundo', '#e3ecf3'),
            borderWidth: 2,
            pointRadius: pontos.length > 40 ? 0 : 3,
            pointHoverRadius: 4,
            tension: 0.2,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: suave, maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { color: suave, callback: (v) => moedaCurta(Number(v)) }, grid: { color: linha } },
        },
        plugins: {
          tooltip: { callbacks: { label: (item) => ` ${moeda(item.parsed.y ?? Number.NaN)}` } },
        },
      },
    })
    return () => grafico?.destroy()
  }, [pontos, escuro])

  return (
    <div class="grafico grafico--linha">
      <canvas ref={canvas} role="img" aria-label={descricao} />
    </div>
  )
}

interface Props {
  snapshots: Snapshot[]
  agora: Date
}

/** Evolução do patrimônio pelos snapshots de fechamento, com seletor de período. */
export function Evolucao({ snapshots, agora }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('Tudo')
  const todos = useMemo(() => pontosValidos(snapshots), [snapshots])
  // Só o dia entra na dependência: o relógio de 1 min não deve recriar o gráfico.
  const hoje = hojeSP(agora)
  const visiveis = useMemo(() => filtrarPontos(todos, periodo, hoje), [todos, periodo, hoje])

  if (todos.length === 0) {
    return (
      <div class="evolucao">
        <p class="neutro evolucao__aviso">
          O histórico começa no primeiro fechamento com pregão. Ainda não há registros.
        </p>
      </div>
    )
  }

  if (todos.length === 1) {
    return (
      <div class="evolucao">
        <p class="evolucao__inicio">{`Histórico começa em ${dataBR(todos[0].data)}`}</p>
        <p class="neutro evolucao__aviso">A linha aparece quando houver pelo menos dois fechamentos.</p>
      </div>
    )
  }

  const resumo = visiveis.length >= 2 ? resumirEvolucao(visiveis) : ''

  return (
    <div class="evolucao">
      <div class="seletor" role="group" aria-label="Período da evolução">
        {PERIODOS.map(({ periodo: p, nome }) => (
          <button
            key={p}
            type="button"
            class="seletor__botao"
            aria-pressed={p === periodo}
            title={nome}
            onClick={() => setPeriodo(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {visiveis.length >= 2 ? (
        <>
          <Linha pontos={visiveis} descricao={`Evolução do patrimônio. ${resumo}`} />
          <p class="evolucao__resumo" data-testid="resumo-evolucao">
            {resumo}
          </p>
          <p class="neutro evolucao__aviso">Inclui aportes e retiradas, não só valorização.</p>
        </>
      ) : (
        <p class="neutro evolucao__aviso">
          {`Menos de dois registros nesse período (primeiro registro: ${dataBR(todos[0].data)}). Escolha um período maior.`}
        </p>
      )}
    </div>
  )
}
