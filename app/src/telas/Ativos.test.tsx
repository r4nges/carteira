import { act, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simularLargura } from '../teste/setup'
import { ativo, cotacao, dadosCarteira, tesouro } from '../teste/fixtures'
import type { Cotacao } from '../lib/tipos'
import type { DadosCarteira } from '../lib/banco'
import { Ativos } from './Ativos'

// Quarta-feira, 28/10/2026, 14:00 em São Paulo: dentro do pregão.
const AGORA = new Date('2026-10-28T17:00:00Z')
const FRESCO = '2026-10-28T16:55:00Z'

/**
 * Carteira fictícia. Total = 611,45 + 464,80 + 362,70 + 930,00 + 310,75 = 2.679,70.
 * FIIA11 7 × 87,35; FIIB11 40 × 11,62; ACAO4 15 × 24,18; Tesouro 0,3 × 3.100; CDB da planilha.
 */
function carteira(p: Partial<DadosCarteira> = {}): DadosCarteira {
  return dadosCarteira({
    ativos: [
      ativo({ codigo: 'FIIA11', tipo: 'FII', quantidade: 7, alvo_pct: 30 }),
      ativo({ codigo: 'FIIB11', tipo: 'FII', quantidade: 40, alvo_pct: 14 }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 15, alvo_pct: null }),
      ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: 0.3, valor_atualizado: 900, alvo_pct: null }),
      ativo({
        codigo: 'CDBA',
        tipo: 'Renda fixa',
        quantidade: 1,
        valor_atualizado: 310.75,
        alvo_pct: null,
        atualizado_em: '2026-10-20T15:00:00Z',
      }),
    ],
    cotacoes: {
      FIIA11: cotacao({
        codigo: 'FIIA11',
        preco: 87.35,
        prev_close: 86.1,
        variacao_dia_pct: 1.45,
        faixa52_min: 71.2,
        faixa52_max: 93.8,
        pvp: 0.91,
        as_of: FRESCO,
      }),
      FIIB11: cotacao({
        codigo: 'FIIB11',
        preco: 11.62,
        prev_close: 11.8,
        variacao_dia_pct: -1.53,
        faixa52_min: 10.05,
        faixa52_max: 12.4,
        posicao_faixa52_pct: 67,
        pvp: 1.07,
        as_of: FRESCO,
      }),
      ACAO4: cotacao({
        codigo: 'ACAO4',
        preco: 24.18,
        prev_close: 24.18,
        variacao_dia_pct: 0,
        faixa52_min: 18.3,
        faixa52_max: 29.7,
        pl: 7.8,
        as_of: FRESCO,
      }),
    },
    tesouros: {
      TESA: tesouro({ codigo: 'TESA', pu_venda: 3100, taxa_venda: 6.85, data_base: '2026-10-23' }),
    },
    ...p,
  })
}

function linha(codigo: string) {
  return screen.getByRole('row', { name: new RegExp(codigo) })
}

describe('Ativos: estado vazio', () => {
  it('mostra a mensagem e leva para Importar', () => {
    const aoNavegar = vi.fn()
    render(<Ativos dados={dadosCarteira()} agora={AGORA} aoNavegar={aoNavegar} />)
    expect(screen.getByText('Nenhum ativo ainda. Importe sua carteira.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }))
    expect(aoNavegar).toHaveBeenCalledWith('importar')
  })
})

describe('Ativos: tabela', () => {
  it('é uma tabela de verdade, com cabeçalhos de coluna e de linha', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const tabela = screen.getByRole('table')
    const colunas = within(tabela).getAllByRole('columnheader')
    expect(colunas.length).toBeGreaterThanOrEqual(6)
    for (const c of colunas) expect(c.getAttribute('scope')).toBe('col')
    const cabecalhoLinha = within(linha('FIIA11')).getByRole('rowheader')
    expect(cabecalhoLinha.getAttribute('scope')).toBe('row')
    expect(cabecalhoLinha.textContent).toContain('FIIA11')
  })

  it('FII: quantidade, P/VP, valor, % da carteira, alvo e quanto falta', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).toContain('7 cotas')
    expect(l).toContain('P/VP 0,91')
    expect(l).toContain('R$ 611,45')
    expect(l).toContain('22,8%')
    expect(l).toContain('alvo 30%')
    expect(l).toContain('faltam R$ 192,46')
  })

  it('Ação usa P/L em vez de P/VP', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('ACAO4').textContent!
    expect(l).toContain('15 ações')
    expect(l).toContain('P/L 7,80')
    expect(l).not.toContain('P/VP')
  })

  it('acima do alvo: "acima R$ x", sem "faltam"', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('FIIB11').textContent!
    expect(l).toContain('acima R$ 89,64')
    expect(l).not.toContain('faltam')
  })

  it('ativo sem alvo mostra "sem alvo" e nenhum "faltam"', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('ACAO4').textContent!
    expect(l).toContain('sem alvo')
    expect(l).not.toContain('faltam')
    expect(l).not.toContain('acima R$')
  })

  it('o traço do alvo existe só quando há alvo', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(linha('FIIA11').querySelector('.peso__alvo')).toBeTruthy()
    expect(linha('ACAO4').querySelector('.peso__alvo')).toBeNull()
  })

  it('preço e variação do dia em % e em R$, com sinal escrito', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const a = linha('FIIA11').textContent!
    expect(a).toContain('R$ 87,35')
    expect(a).toContain('+1,45%')
    expect(a).toContain('+R$ 1,25')
    const b = linha('FIIB11').textContent!
    expect(b).toContain('−1,53%')
    expect(b).toContain('−R$ 0,18')
    const c = linha('ACAO4').textContent!
    expect(c).toContain('0,00%')
    expect(c).not.toContain('+0,00%')
  })

  it('sem variacao_dia_pct, calcula a partir do fechamento anterior', () => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = cotacao({
      codigo: 'FIIA11',
      preco: 88,
      prev_close: 80,
      variacao_dia_pct: null,
      as_of: FRESCO,
    })
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(linha('FIIA11').textContent).toContain('+10,00%')
  })

  it('barra de 52 semanas com descrição e extremos; usa a posição do coletor quando existe', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const a = within(linha('FIIA11')).getByRole('img', { name: /posição na faixa de 52 semanas: 71%/ })
    expect(a).toBeTruthy()
    expect(linha('FIIA11').textContent).toContain('71,20')
    expect(linha('FIIA11').textContent).toContain('93,80')
    expect(within(linha('FIIB11')).getByRole('img', { name: /posição na faixa de 52 semanas: 67%/ })).toBeTruthy()
  })

  it('selo com os limites padrão e com os da configuração', () => {
    const { unmount } = render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('No meio')).toBeTruthy() // 71%
    expect(within(linha('FIIB11')).getByText('No meio')).toBeTruthy() // 67%
    unmount()

    const dados = carteira()
    dados.config = { ...dados.config, limites: { barato: 20, meio: 60, teto: 70 } }
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('Esticado')).toBeTruthy() // 71% > 70
    expect(within(linha('FIIB11')).getByText('Perto do teto')).toBeTruthy() // 67%
  })

  it('Tesouro: valor pelo PU, taxa de venda e data-base; sem barra de 52 semanas', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('TESA')
    expect(l.textContent).toContain('R$ 930,00')
    expect(l.textContent).toContain('6,85%')
    expect(l.textContent).toContain('23/10/2026')
    expect(within(l).queryByRole('img')).toBeNull()
    expect(l.textContent).not.toContain('estimado')
  })

  it('CDB: "valor da planilha de <data>", sem barra', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('CDBA')
    expect(l.textContent).toContain('R$ 310,75')
    expect(l.textContent).toContain('valor da planilha de 20/10/2026')
    expect(within(l).queryByRole('img')).toBeNull()
  })

  it('subtotal "Renda fixa" soma Tesouro e CDB, mostra % e não tem alvo', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    const l = linha('Renda fixa').textContent!
    expect(l).toContain('R$ 1.240,75')
    expect(l).toContain('46,3%')
    expect(l).not.toContain('alvo')
    expect(l).not.toContain('faltam')
    expect(l).not.toContain('acima')
  })

  it('sem renda fixa na carteira, não há subtotal', () => {
    const dados = carteira()
    dados.ativos = dados.ativos.filter((a) => a.tipo !== 'Renda fixa' && a.tipo !== 'Tesouro Direto')
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(screen.queryByRole('row', { name: /Renda fixa/ })).toBeNull()
  })
})

describe('Ativos: erro e valor estimado', () => {
  it('cotação com erro mostra a mensagem e marca o valor da planilha como estimado', () => {
    const dados = carteira()
    dados.cotacoes.ACAO4 = cotacao({
      codigo: 'ACAO4',
      preco: null,
      erro: 'Fonte de cotação fora do ar',
      as_of: FRESCO,
    })
    dados.ativos = dados.ativos.map((a) => (a.codigo === 'ACAO4' ? { ...a, valor_atualizado: 400 } : a))
    render(<Ativos dados={dados} agora={AGORA} />)
    const l = linha('ACAO4').textContent!
    expect(l).toContain('Fonte de cotação fora do ar')
    expect(l).toContain('R$ 400,00')
    expect(l).toContain('valor estimado')
    expect(l).not.toContain('sem cotação')
  })

  it('ativo de bolsa sem cotação nenhuma: valor da planilha marcado como estimado, sem NaN', () => {
    const dados = carteira()
    delete dados.cotacoes.FIIB11
    render(<Ativos dados={dados} agora={AGORA} />)
    const l = linha('FIIB11').textContent!
    expect(l).toContain('valor estimado')
    expect(l).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('valor com preço atual não é marcado como estimado', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(linha('FIIA11').textContent).not.toContain('estimado')
  })
})

describe('Ativos: casos de borda', () => {
  it('sem cotação e sem valor na planilha: "valor indisponível", nunca R$ 0,00 como se fosse real', () => {
    const dados = dadosCarteira({ ativos: [ativo({ codigo: 'FIIA11', valor_atualizado: null })] })
    render(<Ativos dados={dados} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).toContain('valor indisponível')
    expect(l).toContain('cotação indisponível')
    expect(l).not.toContain('R$ 0,00')
  })

  it('exatamente no alvo: "no alvo", sem "faltam" nem "acima"', () => {
    const dados = dadosCarteira({
      ativos: [ativo({ codigo: 'FIIA11', quantidade: 10, alvo_pct: 100 })],
      cotacoes: { FIIA11: cotacao({ preco: 50, as_of: FRESCO }) },
    })
    render(<Ativos dados={dados} agora={AGORA} />)
    const l = linha('FIIA11').textContent!
    expect(l).toContain('no alvo')
    expect(l).not.toContain('faltam')
    expect(l).not.toContain('acima')
  })

  it('resumo mostra o patrimônio e avisa quando há valor estimado', () => {
    const dados = carteira()
    delete dados.cotacoes.FIIB11
    const { container } = render(<Ativos dados={dados} agora={AGORA} />)
    expect(container.querySelector('.ativos__resumo')!.textContent).toMatch(/Patrimônio R\$ .*1 valor é estimado/)
  })
})

describe('Ativos: aviso de defasado', () => {
  it('mostra o banner com a hora da última atualização quando há cotação velha', () => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = { ...dados.cotacoes.FIIA11, as_of: '2026-10-28T15:00:00Z' }
    render(<Ativos dados={dados} agora={AGORA} />)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toMatch(/desatualizad/)
    expect(banner.textContent).toContain('13:55')
  })

  it('marca o ativo defasado na própria linha', () => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = { ...dados.cotacoes.FIIA11, as_of: '2026-10-28T15:00:00Z' }
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('defasado')).toBeTruthy()
    expect(within(linha('FIIB11')).queryByText('defasado')).toBeNull()
  })

  it('sem banner quando tudo está fresco', () => {
    render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('em pregão, cotação de 45 min com coletor em dia não é marcada nem gera banner', () => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = {
      ...dados.cotacoes.FIIA11,
      as_of: '2026-10-28T16:15:00Z',
      atualizado_em: '2026-10-28T16:40:00Z',
    }
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(within(linha('FIIA11')).queryByText('defasado')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('coletor parado (atualizado_em com 71 min) marca o ativo mesmo com as_of recente', () => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = {
      ...dados.cotacoes.FIIA11,
      as_of: '2026-10-28T16:50:00Z',
      atualizado_em: '2026-10-28T15:49:00Z',
    }
    render(<Ativos dados={dados} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('defasado')).toBeTruthy()
    expect(within(linha('FIIB11')).queryByText('defasado')).toBeNull()
  })
})

describe('Ativos: relógio interno', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aba aberta por horas: o relógio renova o "agora" e o ativo passa a ser marcado como defasado', async () => {
    vi.useFakeTimers({ now: AGORA })
    render(<Ativos dados={carteira()} />)
    expect(within(linha('FIIA11')).queryByText('defasado')).toBeNull()
    // O as_of (13:55) só passa dos 90 min às 15:25.
    await act(() => {
      vi.advanceTimersByTime(60 * 60_000)
    })
    expect(within(linha('FIIA11')).queryByText('defasado')).toBeNull()
    await act(() => {
      vi.advanceTimersByTime(26 * 60_000)
    })
    expect(within(linha('FIIA11')).getByText('defasado')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/desatualizad/)
  })

  it('o relógio é desligado ao desmontar', () => {
    vi.useFakeTimers({ now: AGORA })
    const { unmount } = render(<Ativos dados={carteira()} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Ativos: divergência entre fontes', () => {
  const comVerificacao = (verificacao: unknown) => {
    const dados = carteira()
    dados.cotacoes.FIIA11 = { ...dados.cotacoes.FIIA11, verificacao: verificacao as Cotacao['verificacao'] }
    return dados
  }

  it('tabela: marca "fontes divergem X%" quando verificacao.divergente é true', () => {
    render(<Ativos dados={comVerificacao({ brapi_x_yahoo_pct: 4.25, divergente: true })} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('fontes divergem 4,3%')).toBeTruthy()
    expect(within(linha('FIIB11')).queryByText(/fontes divergem/)).toBeNull()
  })

  it('o percentual é em módulo, em pt-BR, também quando a brapi está abaixo da Yahoo', () => {
    render(<Ativos dados={comVerificacao({ brapi_x_yahoo_pct: -3.5, divergente: true })} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('fontes divergem 3,5%')).toBeTruthy()
  })

  it('divergente true sem o percentual: marca sem número', () => {
    render(<Ativos dados={comVerificacao({ divergente: true })} agora={AGORA} />)
    expect(within(linha('FIIA11')).getByText('fontes divergem')).toBeTruthy()
  })

  it('cartão (celular): a mesma marca', () => {
    simularLargura(420)
    render(<Ativos dados={comVerificacao({ brapi_x_yahoo_pct: 4.25, divergente: true })} agora={AGORA} />)
    const cartao = screen.getAllByRole('listitem').find((i) => i.textContent!.includes('FIIA11'))!
    expect(within(cartao).getByText('fontes divergem 4,3%')).toBeTruthy()
    const outro = screen.getAllByRole('listitem').find((i) => i.textContent!.includes('FIIB11'))!
    expect(within(outro).queryByText(/fontes divergem/)).toBeNull()
  })

  it.each([
    ['divergente false', { brapi_x_yahoo_pct: 0.4, divergente: false }],
    ['ausente (null)', null],
    ['texto', 'divergente'],
    ['número', 3],
    ['lista', [true]],
    ['divergente como texto', { divergente: 'true' }],
    ['divergente como número', { brapi_x_yahoo_pct: 9, divergente: 1 }],
    ['objeto vazio', {}],
  ])('verificacao %s: não marca nada e não quebra', (_nome, verificacao) => {
    const { container } = render(<Ativos dados={comVerificacao(verificacao)} agora={AGORA} />)
    expect(container.textContent).not.toMatch(/fontes divergem/)
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it.each([['texto', 'x'], ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['null', null]])(
    'divergente true com percentual inválido (%s): marca sem número',
    (_nome, valor) => {
      render(<Ativos dados={comVerificacao({ brapi_x_yahoo_pct: valor, divergente: true })} agora={AGORA} />)
      expect(within(linha('FIIA11')).getByText('fontes divergem')).toBeTruthy()
    },
  )
})

describe('Ativos: texto limpo', () => {
  it('nunca mostra NaN, undefined ou Infinity, mesmo com dados quebrados', () => {
    const dados = dadosCarteira({
      ativos: [
        ativo({ codigo: 'FIIA11', quantidade: null, valor_atualizado: null, alvo_pct: 25 }),
        ativo({ codigo: 'FIIB11', quantidade: Number.NaN, valor_atualizado: Number.NaN, alvo_pct: Number.NaN }),
        ativo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 3, alvo_pct: 10 }),
        ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: null, valor_atualizado: null }),
        ativo({ codigo: 'CDBA', tipo: 'Renda fixa', valor_atualizado: null, atualizado_em: 'lixo' }),
        ativo({ codigo: 'SEMTIPO', tipo: null }),
      ],
      cotacoes: {
        ACAO4: cotacao({
          codigo: 'ACAO4',
          preco: Number.POSITIVE_INFINITY,
          prev_close: 0,
          variacao_dia_pct: Number.NaN,
          faixa52_min: 5,
          faixa52_max: 5,
          posicao_faixa52_pct: Number.NaN,
          pl: Number.NaN,
          as_of: 'lixo',
        }),
      },
      tesouros: { TESA: tesouro({ codigo: 'TESA', taxa_venda: Number.NaN, data_base: 'lixo', pu_venda: null }) },
    })
    const { container } = render(<Ativos dados={dados} agora={AGORA} />)
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('texto da carteira normal também está limpo', () => {
    const { container } = render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('números usam algarismos tabulares', () => {
    const { container } = render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(container.querySelectorAll('.num').length).toBeGreaterThan(5)
  })
})

describe('Ativos: celular', () => {
  it('abaixo de 900 px cada ativo vira um cartão, sem tabela', () => {
    simularLargura(420)
    render(<Ativos dados={carteira()} agora={AGORA} />)
    expect(screen.queryByRole('table')).toBeNull()
    const itens = screen.getAllByRole('listitem')
    expect(itens.length).toBe(6) // 5 ativos + subtotal de renda fixa
    const cartao = itens.find((i) => i.textContent!.includes('FIIA11'))!
    expect(cartao.textContent).toContain('R$ 611,45')
    expect(cartao.textContent).toContain('22,8%')
    expect(cartao.textContent).toContain('faltam R$ 192,46')
    expect(cartao.textContent).toContain('+1,45%')
    expect(within(cartao).getByRole('img', { name: /posição na faixa de 52 semanas/ })).toBeTruthy()
    expect(within(cartao).getByText('No meio')).toBeTruthy()
  })

  it('o cartão também trata "sem alvo" e valor estimado', () => {
    simularLargura(420)
    const dados = carteira()
    delete dados.cotacoes.ACAO4
    render(<Ativos dados={dados} agora={AGORA} />)
    const cartao = screen.getAllByRole('listitem').find((i) => i.textContent!.includes('ACAO4'))!
    expect(cartao.textContent).toContain('sem alvo')
    expect(cartao.textContent).toContain('valor estimado')
  })
})
