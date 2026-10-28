import { useEffect, useRef } from 'preact/hooks'
import type { DadosCarteira } from '../lib/banco'
import { moeda, pct } from '../lib/formato'
import { cor, criarGrafico } from '../lib/graficos'
import { pesoPct, valorPosicao } from '../lib/metricas'
import { useMidia } from '../lib/useMidia'

export interface Fatia {
  codigo: string
  valor: number
  /** % do patrimônio. */
  peso: number
  rendaFixa: boolean
  /** Valor da planilha, não de uma cotação. */
  estimado: boolean
  /** Token CSS da cor da fatia. */
  token: string
}

const TOKENS_BOLSA = ['--cor-serie-1', '--cor-serie-2', '--cor-serie-3', '--cor-serie-4', '--cor-serie-5', '--cor-serie-6']
const TOKENS_RENDA_FIXA = ['--cor-rf-1', '--cor-rf-2', '--cor-rf-3']
const RESERVAS = ['#1d4f73', '#1b7a4b', '#8a5a00', '#7a4b8f', '#2f7f86', '#a0522d']

/**
 * Uma fatia por ativo com valor: bolsa do maior para o menor, depois a renda fixa (cada título na sua
 * fatia, em cores neutras). Ativo sem valor algum não tem fatia.
 */
export function montarFatias(dados: Pick<DadosCarteira, 'ativos' | 'cotacoes' | 'tesouros'>): Fatia[] {
  const brutas = dados.ativos.map((a) => {
    const { valor, estimado } = valorPosicao(a, dados.cotacoes[a.codigo], dados.tesouros[a.codigo])
    return { codigo: a.codigo, valor, estimado, rendaFixa: a.tipo === 'Tesouro Direto' || a.tipo === 'Renda fixa' }
  })
  const total = brutas.reduce((s, f) => s + f.valor, 0)
  const ordenadas = brutas
    .filter((f) => f.valor > 0)
    .sort((a, b) => Number(a.rendaFixa) - Number(b.rendaFixa) || b.valor - a.valor)
  let nBolsa = 0
  let nFixa = 0
  return ordenadas.map((f) => ({
    ...f,
    peso: pesoPct(f.valor, total),
    token: f.rendaFixa
      ? TOKENS_RENDA_FIXA[nFixa++ % TOKENS_RENDA_FIXA.length]
      : TOKENS_BOLSA[nBolsa++ % TOKENS_BOLSA.length],
  }))
}

/** Texto da rosca para leitor de tela: o mesmo que a legenda. */
export function descreverFatias(fatias: Fatia[]): string {
  return `Composição da carteira: ${fatias.map((f) => `${f.codigo} ${pct(f.peso)}`).join(', ')}.`
}

function reservaDe(token: string): string {
  const i = TOKENS_BOLSA.indexOf(token)
  return i >= 0 ? RESERVAS[i] : '#8a948f'
}

interface Props {
  fatias: Fatia[]
}

/** Rosca de composição por ativo, com legenda em texto (o canvas sozinho não é acessível). */
export function Rosca({ fatias }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Muda o tema do sistema: as cores do canvas são lidas de novo.
  const escuro = useMidia('(prefers-color-scheme: dark)')
  const descricao = descreverFatias(fatias)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const grafico = criarGrafico(el, {
      type: 'doughnut',
      data: {
        labels: fatias.map((f) => f.codigo),
        datasets: [
          {
            data: fatias.map((f) => f.valor),
            backgroundColor: fatias.map((f) => cor(f.token, reservaDe(f.token))),
            borderColor: cor('--cor-superficie', '#ffffff'),
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        animation: false,
        plugins: {
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${moeda(item.parsed)} (${pct(fatias[item.dataIndex]?.peso ?? 0)})`,
            },
          },
        },
      },
    })
    return () => grafico?.destroy()
  }, [fatias, escuro])

  return (
    <div class="rosca">
      <div class="grafico grafico--rosca">
        <canvas ref={canvas} role="img" aria-label={descricao} />
      </div>
      <ul class="legenda" aria-label="Composição da carteira, % do patrimônio">
        {fatias.map((f) => (
          <li key={f.codigo} class="legenda__item">
            <span class="legenda__cor" style={{ background: `var(${f.token})` }} aria-hidden="true" />
            <span class="legenda__nome">{f.codigo}</span>
            <span class="num legenda__pct">{pct(f.peso)}</span>
            <span class="num neutro legenda__valor">{moeda(f.valor)}</span>
            {f.rendaFixa && <span class="neutro legenda__nota">renda fixa</span>}
            {f.estimado && <span class="etiqueta etiqueta--aviso">estimado pela planilha</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
