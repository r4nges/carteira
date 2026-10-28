import { act, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DadosCarteira } from '../lib/banco'
import { simularLargura } from '../teste/setup'
import { ativo, cotacao, dadosCarteira, tesouro } from '../teste/fixtures'
import { Proventos } from './Proventos'

// Quarta-feira, 28/10/2026, 14:00 em São Paulo: dentro do pregão.
const AGORA = new Date('2026-10-28T17:00:00Z')
const FRESCO = '2026-10-28T16:55:00Z'

function carteira(p: Partial<DadosCarteira> = {}): DadosCarteira {
  return dadosCarteira({
    ativos: [
      ativo({ codigo: 'FIIB11', tipo: 'FII' }),
      ativo({ codigo: 'FIIA11', tipo: 'FII' }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação' }),
      ativo({ codigo: 'TESA', tipo: 'Tesouro Direto' }),
      ativo({ codigo: 'CDBA', tipo: 'Renda fixa' }),
    ],
    cotacoes: {
      FIIA11: cotacao({
        codigo: 'FIIA11',
        as_of: FRESCO,
        dy_12m_pct: 9.37,
        proventos_12m: 1.08,
        ultimo_rendimento: { valor: 0.09, data: '2026-10-15' },
      }),
      FIIB11: cotacao({
        codigo: 'FIIB11',
        as_of: FRESCO,
        dy_12m_pct: 7.5,
        proventos_12m: 0.9,
        ultimo_rendimento: null,
      }),
      ACAO4: cotacao({ codigo: 'ACAO4', as_of: FRESCO, dy_12m_pct: null, proventos_12m: null }),
    },
    tesouros: { TESA: tesouro({ codigo: 'TESA' }) },
    ...p,
  })
}

const linha = (codigo: string) => screen.getByRole('row', { name: new RegExp(codigo) })

describe('Proventos: tabela', () => {
  it('mostra só ativos de bolsa, em ordem de código', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    const codigos = within(screen.getByRole('table'))
      .getAllByRole('rowheader')
      .map((c) => c.textContent)
    expect(codigos).toEqual(['ACAO4', 'FIIA11', 'FIIB11'])
    expect(screen.queryByText('TESA')).toBeNull()
    expect(screen.queryByText('CDBA')).toBeNull()
  })

  it('é uma tabela de verdade, com cabeçalhos de coluna e de linha', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    for (const c of within(screen.getByRole('table')).getAllByRole('columnheader')) {
      expect(c.getAttribute('scope')).toBe('col')
    }
    expect(within(linha('FIIA11')).getByRole('rowheader').getAttribute('scope')).toBe('row')
  })

  it('último rendimento com valor e data, DY e proventos de 12 meses', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).toContain('R$ 0,09')
    expect(l).toContain('15/10/2026')
    expect(l).toContain('9,37%')
    expect(l).toContain('R$ 1,08')
  })

  it('último rendimento nulo mostra "—" e não quebra', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    const l = linha('FIIB11').textContent!
    expect(l).toContain('—')
    expect(l).toContain('7,50%')
    expect(l).toContain('R$ 0,90')
    expect(l).not.toMatch(/NaN|undefined|null/)
  })

  it('ativo com cotação sem nenhum dado mostra "—" nos três campos', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    const celulas = within(linha('ACAO4')).getAllByRole('cell')
    const textos = celulas.map((c) => c.textContent)
    expect(textos.filter((t) => t === '—')).toHaveLength(3)
  })

  it('ativo sem linha de cotação mostra "—" e a marca de sem dados', () => {
    render(<Proventos dados={carteira({ cotacoes: {} })} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).not.toMatch(/NaN|undefined|null/)
    expect(l).toContain('sem dados')
  })

  it.each([
    ['NaN', { valor: Number.NaN, data: '2026-10-15' }],
    ['Infinity', { valor: Infinity, data: '2026-10-15' }],
    ['texto', { valor: 'x', data: '2026-10-15' }],
    ['lista', [1, 2]],
    ['texto solto', 'abc'],
    ['número solto', 7],
    ['sem valor', { data: '2026-10-15' }],
  ])('último rendimento malformado (%s) vira "—"', (_nome, json) => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: {
            FIIA11: cotacao({ codigo: 'FIIA11', as_of: FRESCO, ultimo_rendimento: json as never }),
          },
        })}
        agora={AGORA}
      />,
    )
    const l = linha('FIIA11').textContent!
    expect(l).toContain('—')
    expect(l).not.toMatch(/NaN|Infinity|undefined|null/)
  })

  it('valor sem data: mostra o valor e "—" no lugar da data', () => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: {
            FIIA11: cotacao({ codigo: 'FIIA11', as_of: FRESCO, ultimo_rendimento: { valor: 0.09 } }),
          },
        })}
        agora={AGORA}
      />,
    )
    const l = linha('FIIA11').textContent!
    expect(l).toContain('R$ 0,09')
    expect(l).toContain('data indisponível')
  })

  it('DY e proventos não finitos viram "—"', () => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: {
            FIIA11: cotacao({ codigo: 'FIIA11', as_of: FRESCO, dy_12m_pct: Number.NaN, proventos_12m: Infinity }),
          },
        })}
        agora={AGORA}
      />,
    )
    expect(linha('FIIA11').textContent).not.toMatch(/NaN|Infinity/)
  })

  it('mostra hora e fonte do dado', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).toContain('às 13:55')
    expect(l).toContain('coletor')
  })

  it('dado de outro dia mostra a data junto da hora', () => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: { FIIA11: cotacao({ codigo: 'FIIA11', as_of: '2026-10-27T20:00:00Z', dy_12m_pct: 9 }) },
        })}
        agora={AGORA}
      />,
    )
    expect(linha('FIIA11').textContent).toContain('27/10/2026 às 17:00')
  })

  it('marca "defasado" no dado velho e o banner avisa', () => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: {
            FIIA11: cotacao({ codigo: 'FIIA11', as_of: '2026-10-20T17:00:00Z', dy_12m_pct: 9 }),
            FIIB11: cotacao({ codigo: 'FIIB11', as_of: FRESCO, dy_12m_pct: 7 }),
            ACAO4: cotacao({ codigo: 'ACAO4', as_of: FRESCO }),
          },
        })}
        agora={AGORA}
      />,
    )
    expect(within(linha('FIIA11')).getByText('defasado')).toBeTruthy()
    expect(within(linha('FIIB11')).queryByText('defasado')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/1 de 3 ativos/)
  })

  it('em pregão, dado de 45 min com coletor em dia não é "defasado"', () => {
    render(
      <Proventos
        dados={carteira({
          cotacoes: {
            FIIA11: cotacao({ codigo: 'FIIA11', as_of: '2026-10-28T16:15:00Z', atualizado_em: '2026-10-28T16:40:00Z', dy_12m_pct: 9 }),
            FIIB11: cotacao({ codigo: 'FIIB11', as_of: FRESCO, dy_12m_pct: 7 }),
            ACAO4: cotacao({ codigo: 'ACAO4', as_of: FRESCO }),
          },
        })}
        agora={AGORA}
      />,
    )
    expect(within(linha('FIIA11')).queryByText('defasado')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('não dá conselho nem calcula nada: só repassa o que o coletor trouxe', () => {
    render(<Proventos dados={carteira()} agora={AGORA} />)
    expect(document.body.textContent).not.toMatch(/compre|venda|recomend|vale a pena/i)
  })
})

describe('Proventos: relógio interno', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aba aberta por horas: o relógio renova o "agora" e o dado passa a ser marcado como defasado', async () => {
    vi.useFakeTimers({ now: AGORA })
    render(<Proventos dados={carteira()} />)
    expect(within(linha('FIIA11')).queryByText('defasado')).toBeNull()
    await act(() => {
      vi.advanceTimersByTime(86 * 60_000)
    })
    expect(within(linha('FIIA11')).getByText('defasado')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/desatualizad/)
  })

  it('o relógio é desligado ao desmontar', () => {
    vi.useFakeTimers({ now: AGORA })
    const { unmount } = render(<Proventos dados={carteira()} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Proventos: estados', () => {
  it('carteira vazia leva para Importar', () => {
    const aoNavegar = vi.fn()
    render(<Proventos dados={dadosCarteira()} agora={AGORA} aoNavegar={aoNavegar} />)
    expect(screen.getByText('Nenhum ativo ainda. Importe sua carteira.')).toBeTruthy()
  })

  it('só renda fixa: explica que proventos são de ativos de bolsa', () => {
    render(
      <Proventos
        dados={carteira({ ativos: [ativo({ codigo: 'TESA', tipo: 'Tesouro Direto' })] })}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Nenhum ativo de bolsa na carteira.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Proventos: celular', () => {
  it('vira cartões, com os mesmos dados', () => {
    simularLargura(400)
    render(<Proventos dados={carteira()} agora={AGORA} />)
    expect(screen.queryByRole('table')).toBeNull()
    const cartoes = screen.getAllByRole('listitem')
    expect(cartoes).toHaveLength(3)
    const fiia = cartoes.find((c) => c.textContent!.includes('FIIA11'))!.textContent!
    expect(fiia).toContain('R$ 0,09')
    expect(fiia).toContain('15/10/2026')
    expect(fiia).toContain('9,37%')
    expect(fiia).toContain('R$ 1,08')
    const fiib = cartoes.find((c) => c.textContent!.includes('FIIB11'))!.textContent!
    expect(fiib).toContain('—')
  })
})
