import { act, fireEvent, render, screen, within } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DadosCarteira } from '../lib/banco'
import type { Snapshot } from '../lib/tipos'
import { ativo, cotacao, dadosCarteira, noticia, tesouro } from '../teste/fixtures'
import { Inicio } from './Inicio'

// Chart.js precisa de canvas, que o jsdom não tem: o mock guarda cada gráfico criado
// (tipo, configuração com os dados e se foi destruído) para os testes conferirem o que
// a tela entregou ao gráfico.
const graficos = vi.hoisted(() => {
  interface Criado {
    tipo: string
    config: {
      type: string
      data: { labels: string[]; datasets: { data: number[] }[] }
    }
    destruido: boolean
  }
  const criados: Criado[] = []
  // Quando preenchido, o construtor do Chart lança este erro.
  const falha: { erro: Error | null } = { erro: null }
  return { criados, falha }
})

vi.mock('chart.js', () => {
  class Chart {
    static register = vi.fn()
    registro: (typeof graficos.criados)[number]
    constructor(_canvas: unknown, config: (typeof graficos.criados)[number]['config']) {
      if (graficos.falha.erro) throw graficos.falha.erro
      this.registro = { tipo: config.type, config, destruido: false }
      graficos.criados.push(this.registro)
    }
    destroy() {
      this.registro.destruido = true
    }
  }
  const vazio = {}
  return {
    Chart,
    ArcElement: vazio,
    DoughnutController: vazio,
    LineController: vazio,
    LineElement: vazio,
    PointElement: vazio,
    CategoryScale: vazio,
    LinearScale: vazio,
    Tooltip: vazio,
    Filler: vazio,
  }
})

function ultimo(tipo: 'doughnut' | 'line') {
  return graficos.criados.filter((g) => g.tipo === tipo).at(-1)
}

// Quarta-feira, 28/10/2026, 14:00 em São Paulo: dentro do pregão.
const AGORA = new Date('2026-10-28T17:00:00Z')
const FRESCO = '2026-10-28T16:55:00Z'

function snap(data: string, patrimonio: number | null): Snapshot {
  return { data, patrimonio, posicoes: null }
}

/**
 * Carteira fictícia. Total = 611,45 + 464,80 + 362,70 + 930,00 + 310,75 = 2.679,70.
 * Variação do dia: FIIA11 7 × (87,35 − 80) = +51,45; FIIB11 40 × (11,62 − 12,40) = −31,20;
 * ACAO4 15 × (24,18 − 26) = −27,30. Soma −7,05 sobre a base de 1.446,00 (−0,49%).
 */
function carteira(p: Partial<DadosCarteira> = {}): DadosCarteira {
  return dadosCarteira({
    ativos: [
      ativo({ codigo: 'FIIA11', tipo: 'FII', quantidade: 7 }),
      ativo({ codigo: 'FIIB11', tipo: 'FII', quantidade: 40 }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 15 }),
      ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: 0.3, valor_atualizado: 900 }),
      ativo({ codigo: 'CDBA', tipo: 'Renda fixa', quantidade: 1, valor_atualizado: 310.75 }),
    ],
    cotacoes: {
      FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, preco_fonte: 'brapi', as_of: FRESCO }),
      FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: FRESCO }),
      ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: FRESCO }),
    },
    tesouros: { TESA: tesouro({ codigo: 'TESA', pu_venda: 3100, data_base: '2026-10-23' }) },
    snapshots: [
      snap('2026-09-01', 2400),
      snap('2026-10-10', 2500),
      snap('2026-10-20', 2550),
      snap('2026-10-21', 2600),
      snap('2026-10-23', 2650),
      snap('2026-10-27', 2700),
    ],
    ...p,
  })
}

beforeEach(() => {
  graficos.criados.length = 0
  graficos.falha.erro = null
  try {
    window.localStorage.clear()
  } catch {
    // sem armazenamento: o teste que precisa dele cria o próprio cenário
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Início: carteira vazia', () => {
  it('mostra o estado vazio com o caminho para Importar, sem gráficos nem NaN', () => {
    const aoNavegar = vi.fn()
    const { container } = render(<Inicio dados={dadosCarteira()} agora={AGORA} aoNavegar={aoNavegar} />)
    expect(screen.getByText('Nenhum ativo ainda. Importe sua carteira.')).toBeTruthy()
    expect(container.querySelector('canvas')).toBeNull()
    expect(graficos.criados).toHaveLength(0)
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }))
    expect(aoNavegar).toHaveBeenCalledWith('importar')
  })

  it('ativos sem nenhum valor utilizável não geram rosca nem NaN', () => {
    const dados = dadosCarteira({
      ativos: [ativo({ codigo: 'FIIA11', quantidade: null, valor_atualizado: null })],
    })
    const { container } = render(<Inicio dados={dados} agora={AGORA} />)
    expect(ultimo('doughnut')).toBeUndefined()
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
    expect(screen.getByText(/Sem valores para mostrar a composição/)).toBeTruthy()
  })
})

describe('Início: abas', () => {
  it('abre na aba Carteira e oferece Carteira e Notícias', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.textContent)).toEqual(['Carteira', 'Notícias'])
    expect(screen.getByRole('tab', { name: 'Carteira' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Notícias' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('Notícias troca o painel e desmonta os gráficos', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const aoAbrir = graficos.criados.length
    expect(aoAbrir).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Notícias' }))
    expect(screen.getByRole('tab', { name: 'Notícias' }).getAttribute('aria-selected')).toBe('true')
    expect(graficos.criados.every((g) => g.destruido)).toBe(true)
    expect(screen.queryByText(/Patrimônio/)).toBeNull()
  })

  it('Notícias mostra as notícias e o briefing vindos dos dados, e o aviso de leitura', () => {
    const dados = {
      ...carteira(),
      noticias: [noticia({ titulo: 'Manchete de teste', tema: 'mundo', publicado_em: '2026-10-28T16:35:00Z' })],
      indicadores: { briefing_mercado: { texto: 'Texto de mercado.', as_of: '2026-10-28T16:30:00Z' } },
      avisoNoticias: 'Aviso de teste',
    }
    render(<Inicio dados={dados} agora={AGORA} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Notícias' }))
    expect(screen.getByRole('link', { name: 'Manchete de teste' })).toBeTruthy()
    expect(screen.getByText('Texto de mercado.')).toBeTruthy()
    expect(screen.getByText('Aviso de teste')).toBeTruthy()
  })

  it('Notícias sem nenhuma notícia diz que ainda não há coleta', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Notícias' }))
    expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
  })

  it('lembra a última aba aberta', () => {
    const primeira = render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Notícias' }))
    primeira.unmount()
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByRole('tab', { name: 'Notícias' }).getAttribute('aria-selected')).toBe('true')
  })

  it('funciona sem localStorage (leitura e escrita falham)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByRole('tab', { name: 'Carteira' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Notícias' }))
    expect(screen.getByRole('tab', { name: 'Notícias' }).getAttribute('aria-selected')).toBe('true')
  })

  it('ignora um valor guardado que não é uma aba', () => {
    window.localStorage.setItem('carteira.inicio.aba', 'qualquer-coisa')
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByRole('tab', { name: 'Carteira' }).getAttribute('aria-selected')).toBe('true')
  })

  it('setas do teclado trocam de aba', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Carteira' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Notícias' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Notícias' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Carteira' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('Início: patrimônio e variação do dia', () => {
  it('mostra o patrimônio e a variação do dia em R$ e %, com sinal escrito', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByTestId('patrimonio').textContent).toBe('R$ 2.679,70')
    const v = screen.getByTestId('variacao-dia').textContent!
    expect(v).toContain('−R$ 7,05')
    expect(v).toContain('−0,5%')
    expect(v).toContain('hoje')
  })

  it('no mesmo dia da cotação: "hoje" e "Movimentações do dia"', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByTestId('variacao-dia').textContent).toMatch(/ hoje$/)
    expect(screen.getByRole('heading', { name: 'Movimentações do dia' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/no pregão de/)
  })

  it('no sábado, a variação é do pregão de sexta e não diz "hoje"', () => {
    // Sábado 31/10/2026, 12:00 em SP; a cotação mais recente é de sexta 30/10, 17:55.
    const sabado = new Date('2026-10-31T15:00:00Z')
    const sexta = '2026-10-30T20:55:00Z'
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: sexta }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: sexta }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: sexta }),
      },
    })
    render(<Inicio dados={dados} agora={sabado} />)
    const v = screen.getByTestId('variacao-dia').textContent!
    expect(v).toContain('−R$ 7,05')
    expect(v).toMatch(/ no pregão de 30\/10$/)
    expect(v).not.toContain('hoje')
    expect(screen.getByRole('heading', { name: 'Movimentações do pregão de 30/10' })).toBeTruthy()
    expect(screen.getByRole('list', { name: /Movimentações do pregão de 30\/10/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Movimentações do dia' })).toBeNull()
  })

  it('antes da abertura (dia útil), o pregão mostrado é o do dia anterior', () => {
    // Quinta 29/10, 09:00 em SP; cotações de quarta 28/10 às 17:55.
    const cedo = new Date('2026-10-29T12:00:00Z')
    const quarta = '2026-10-28T20:55:00Z'
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: quarta }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: quarta }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: quarta }),
      },
    })
    render(<Inicio dados={dados} agora={cedo} />)
    expect(screen.getByTestId('variacao-dia').textContent).toMatch(/no pregão de 28\/10$/)
  })

  it('variação positiva leva "+" e a classe de alta', () => {
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 90, prev_close: 80, as_of: FRESCO }),
      },
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    const el = screen.getByTestId('variacao-dia')
    expect(el.textContent).toContain('+R$ 70,00')
    expect(el.textContent).toContain('+12,5%')
    expect(el.className).toContain('alta')
  })

  it('"atualizado às HH:MM" usa a cotação mais recente e cita a fonte', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.getByTestId('atualizado').textContent).toBe('atualizado às 13:55 · brapi')
  })

  it('cotação de outro dia mostra a data junto da hora', () => {
    const dados = carteira({
      cotacoes: { FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: '2026-10-23T20:30:00Z' }) },
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByTestId('atualizado').textContent).toContain('23/10/2026 às 17:30')
  })

  it('sem fechamento anterior a variação é indisponível, nunca zero inventado', () => {
    const dados = carteira({
      cotacoes: { FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: null, as_of: FRESCO }) },
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByTestId('variacao-dia').textContent).toMatch(/indisponível/)
    expect(screen.getByTestId('variacao-dia').textContent).not.toMatch(/0,0%|R\$ 0,00/)
  })

  it('sem nenhuma cotação, o patrimônio vem da planilha, marcado como estimado, e não zera', () => {
    const dados = dadosCarteira({
      ativos: [ativo({ codigo: 'FIIA11', quantidade: 7, valor_atualizado: 600 })],
    })
    const { container } = render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByTestId('patrimonio').textContent).toBe('R$ 600,00')
    expect(container.textContent).toMatch(/1 valor é estimado/)
    expect(screen.getByTestId('atualizado').textContent).toMatch(/sem horário/i)
    expect(container.textContent).not.toMatch(/NaN/)
  })
})

describe('Início: botão Atualizar', () => {
  it('sem aoAtualizar, não mostra o botão', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.queryByRole('button', { name: /Atualizar/ })).toBeNull()
  })

  it('fica ao lado do "atualizado …" e chama aoAtualizar ao clicar', () => {
    const aoAtualizar = vi.fn()
    render(<Inicio dados={carteira()} agora={AGORA} aoAtualizar={aoAtualizar} />)
    const botao = screen.getByRole('button', { name: 'Atualizar' })
    expect(botao.parentElement).toBe(screen.getByTestId('atualizado').parentElement)
    expect((botao as HTMLButtonElement).type).toBe('button')
    fireEvent.click(botao)
    expect(aoAtualizar).toHaveBeenCalledTimes(1)
  })

  it('desabilitado e marcado como ocupado enquanto atualiza', () => {
    const aoAtualizar = vi.fn()
    render(<Inicio dados={carteira()} agora={AGORA} aoAtualizar={aoAtualizar} atualizando />)
    const botao = screen.getByRole('button', { name: 'Atualizar' }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(botao)
    expect(aoAtualizar).not.toHaveBeenCalled()
  })

  it('quando a última atualização falhou, avisa em texto e mantém os dados na tela', () => {
    render(<Inicio dados={carteira()} agora={AGORA} aoAtualizar={() => {}} falhaAtualizacao />)
    expect(screen.getByText('Não foi possível atualizar agora.')).toBeTruthy()
    expect(screen.getByTestId('patrimonio').textContent).toBe('R$ 2.679,70')
  })

  it('sem falha, não mostra o aviso', () => {
    render(<Inicio dados={carteira()} agora={AGORA} aoAtualizar={() => {}} />)
    expect(screen.queryByText(/Não foi possível atualizar/)).toBeNull()
  })
})

describe('Início: banner de defasado', () => {
  it('coletor parado: banner e "atualizado às" com a hora velha, não a atual', () => {
    const velho = '2026-10-28T14:00:00Z' // 11:00 em SP; agora são 14:00 em pleno pregão
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: velho }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: velho }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: velho }),
      },
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByText(/3 de 3 ativos estão com cotação desatualizada/)).toBeTruthy()
    expect(screen.getByTestId('atualizado').textContent).toContain('às 11:00')
  })

  it('em pregão, cotação com 30 a 60 min (atraso normal do mercado e do coletor) não acende o banner', () => {
    const cotacoes = {
      FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: '2026-10-28T16:30:00Z', atualizado_em: '2026-10-28T16:40:00Z' }),
      FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: '2026-10-28T16:00:00Z', atualizado_em: '2026-10-28T16:40:00Z' }),
      ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: '2026-10-28T16:25:00Z', atualizado_em: '2026-10-28T16:40:00Z' }),
    }
    render(<Inicio dados={carteira({ cotacoes })} agora={AGORA} />)
    expect(screen.queryByText(/desatualizada/)).toBeNull()
    expect(screen.queryByText('defasado')).toBeNull()
  })

  it('sem banner quando tudo está fresco', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(screen.queryByText(/desatualizada/)).toBeNull()
  })

  it('aba aberta por muito tempo: o relógio interno faz o dado envelhecer e o banner aparecer', async () => {
    vi.useFakeTimers({ now: AGORA })
    render(<Inicio dados={carteira()} />)
    expect(screen.queryByText(/desatualizada/)).toBeNull()
    // O as_of (13:55) só passa dos 90 min às 15:25: depois de 86 min o dado tem 91 min em pleno pregão.
    await act(() => {
      vi.advanceTimersByTime(60 * 60_000)
    })
    expect(screen.queryByText(/desatualizada/)).toBeNull()
    await act(() => {
      vi.advanceTimersByTime(26 * 60_000)
    })
    expect(screen.getByText(/3 de 3 ativos estão com cotação desatualizada/)).toBeTruthy()
  })

  it('o relógio interno é desligado ao desmontar', () => {
    vi.useFakeTimers({ now: AGORA })
    const { unmount } = render(<Inicio dados={carteira()} />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Início: rosca de composição', () => {
  it('entrega ao gráfico um item por ativo: bolsa por valor, depois renda fixa em fatias separadas', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const rosca = ultimo('doughnut')!
    expect(rosca.config.data.labels).toEqual(['FIIA11', 'FIIB11', 'ACAO4', 'TESA', 'CDBA'])
    expect(rosca.config.data.datasets[0].data).toEqual([611.45, 464.8, 362.7, 930, 310.75])
  })

  it('legenda em texto com o % de cada ativo', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const legenda = screen.getByRole('list', { name: /Composição da carteira/ })
    const itens = within(legenda).getAllByRole('listitem').map((li) => li.textContent!)
    expect(itens[0]).toContain('FIIA11')
    expect(itens[0]).toContain('22,8%')
    expect(itens[1]).toContain('17,3%')
    expect(itens[3]).toContain('TESA')
    expect(itens[3]).toContain('34,7%')
    expect(itens[3]).toContain('renda fixa')
    expect(itens[4]).toContain('CDBA')
    expect(itens[4]).toContain('renda fixa')
  })

  it('ativo com valor estimado entra na rosca, mas a legenda diz que veio da planilha', () => {
    const dados = carteira({ cotacoes: {} })
    render(<Inicio dados={dados} agora={AGORA} />)
    const rosca = ultimo('doughnut')!
    expect(rosca.config.data.labels).toContain('FIIA11')
    const legenda = screen.getByRole('list', { name: /Composição da carteira/ })
    const item = within(legenda).getByText(/FIIA11/).closest('li')!
    expect(item.textContent).toContain('estimado pela planilha')
    expect(item.textContent).not.toMatch(/cotação/i)
  })

  it('o gráfico tem alternativa em texto', () => {
    const { container } = render(<Inicio dados={carteira()} agora={AGORA} />)
    const canvas = container.querySelector('canvas[aria-label*="Composição"]')!
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toContain('FIIA11 22,8%')
  })

  it('destrói a rosca ao desmontar', () => {
    const { unmount } = render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(ultimo('doughnut')!.destruido).toBe(false)
    unmount()
    expect(graficos.criados.every((g) => g.destruido)).toBe(true)
  })

  it('o relógio interno não recria os gráficos', async () => {
    vi.useFakeTimers({ now: AGORA })
    render(<Inicio dados={carteira()} />)
    const antes = graficos.criados.length
    await act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(graficos.criados.length).toBe(antes)
  })
})

describe('Início: evolução do patrimônio', () => {
  it('"Tudo" é o padrão e entrega todos os snapshots em ordem crescente de data', () => {
    const dados = carteira({
      snapshots: [snap('2026-10-23', 2650), snap('2026-10-10', 2500), snap('2026-10-27', 2700)],
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    const linha = ultimo('line')!
    expect(linha.config.data.labels).toEqual(['10/10/2026', '23/10/2026', '27/10/2026'])
    expect(linha.config.data.datasets[0].data).toEqual([2500, 2650, 2700])
  })

  it('seletor com 1S, 1M, 3M, 1A e Tudo', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const grupo = screen.getByRole('group', { name: /Período/ })
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['1S', '1M', '3M', '1A', 'Tudo'])
    expect(within(grupo).getByRole('button', { name: 'Tudo' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('1S filtra os snapshots dos últimos 7 dias', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.click(screen.getByRole('button', { name: '1S' }))
    const linha = ultimo('line')!
    expect(linha.config.data.labels).toEqual(['21/10/2026', '23/10/2026', '27/10/2026'])
    expect(linha.config.data.datasets[0].data).toEqual([2600, 2650, 2700])
    expect(screen.getByRole('button', { name: '1S' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('1M pega 30 dias e 3M pega 90', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    // 28/10 − 30 dias = 28/09: fica de fora o snapshot de 01/09.
    expect(ultimo('line')!.config.data.labels[0]).toBe('10/10/2026')
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    expect(ultimo('line')!.config.data.labels[0]).toBe('01/09/2026')
  })

  it('a troca de período destrói o gráfico anterior', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const antes = ultimo('line')!
    fireEvent.click(screen.getByRole('button', { name: '1S' }))
    expect(antes.destruido).toBe(true)
    expect(ultimo('line')!.destruido).toBe(false)
  })

  it('um único snapshot: "Histórico começa em dd/mm/aaaa" e nenhuma linha', () => {
    const dados = carteira({ snapshots: [snap('2026-10-27', 2700)] })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByText('Histórico começa em 27/10/2026')).toBeTruthy()
    expect(ultimo('line')).toBeUndefined()
  })

  it('sem snapshots: avisa que o histórico ainda não começou, sem data inventada', () => {
    const dados = carteira({ snapshots: [] })
    const { container } = render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.getByText(/O histórico começa no primeiro fechamento/)).toBeTruthy()
    expect(ultimo('line')).toBeUndefined()
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('período com menos de dois registros: explica e não desenha linha', () => {
    const dados = carteira({ snapshots: [snap('2026-09-01', 2400), snap('2026-10-10', 2500)] })
    render(<Inicio dados={dados} agora={AGORA} />)
    fireEvent.click(screen.getByRole('button', { name: '1S' }))
    expect(screen.getByText(/Menos de dois registros nesse período/)).toBeTruthy()
    expect(screen.getByText(/primeiro registro: 01\/09\/2026/)).toBeTruthy()
    expect(ultimo('line')!.destruido).toBe(true)
  })

  it('ignora snapshots sem patrimônio válido', () => {
    const dados = carteira({
      snapshots: [snap('2026-10-23', 2650), snap('2026-10-24', null), snap('2026-10-27', 2700)],
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(ultimo('line')!.config.data.datasets[0].data).toEqual([2650, 2700])
  })

  it('resumo em texto: período, valores e variação', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    fireEvent.click(screen.getByRole('button', { name: '1S' }))
    const resumo = screen.getByTestId('resumo-evolucao').textContent!
    expect(resumo).toContain('21/10/2026')
    expect(resumo).toContain('27/10/2026')
    expect(resumo).toContain('R$ 2.600,00')
    expect(resumo).toContain('R$ 2.700,00')
    expect(resumo).toContain('+R$ 100,00')
    expect(resumo).toContain('+3,8%')
  })

  it('destrói a linha ao desmontar', () => {
    const { unmount } = render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(ultimo('line')!.destruido).toBe(false)
    unmount()
    expect(ultimo('line')!.destruido).toBe(true)
  })
})

describe('Início: movimentações do dia', () => {
  function itens() {
    const lista = screen.getByRole('list', { name: /Movimentações do dia/ })
    return within(lista).getAllByRole('listitem').map((li) => li.textContent!)
  }

  it('ordena pelo maior impacto em R$ (valor absoluto), não pelo %', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const l = itens()
    // |R$|: FIIA11 51,45 > FIIB11 31,20 > ACAO4 27,30. Pelo % seria FIIA11, ACAO4, FIIB11.
    expect(l.map((t) => /^(FIIA11|FIIB11|ACAO4)/.exec(t)![1])).toEqual(['FIIA11', 'FIIB11', 'ACAO4'])
  })

  it('cada linha mostra a variação em % e em R$ da posição', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    const l = itens()
    expect(l[0]).toContain('+9,19%')
    expect(l[0]).toContain('+R$ 51,45')
    expect(l[1]).toContain('−6,29%')
    expect(l[1]).toContain('−R$ 31,20')
    expect(l[2]).toContain('−7,00%')
    expect(l[2]).toContain('−R$ 27,30')
  })

  it('renda fixa e Tesouro não entram na lista', () => {
    render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(itens().join(' ')).not.toMatch(/TESA|CDBA/)
  })

  it('ativo sem fechamento anterior fica fora da lista, com aviso', () => {
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: null, as_of: FRESCO }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: FRESCO }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: FRESCO }),
      },
    })
    const { container } = render(<Inicio dados={dados} agora={AGORA} />)
    expect(itens()).toHaveLength(2)
    expect(container.textContent).toMatch(/1 ativo sem fechamento anterior/)
  })

  it('cotação defasada continua na lista, marcada', () => {
    const dados = carteira({
      cotacoes: {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80, as_of: '2026-10-28T14:00:00Z' }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4, as_of: FRESCO }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26, as_of: FRESCO }),
      },
    })
    render(<Inicio dados={dados} agora={AGORA} />)
    const l = itens()
    expect(l).toHaveLength(3)
    expect(l[0]).toContain('defasado')
    expect(l[1]).not.toContain('defasado')
  })

  it('sem nenhuma movimentação calculável, diz isso em vez de mostrar lista vazia', () => {
    const dados = carteira({ cotacoes: {} })
    render(<Inicio dados={dados} agora={AGORA} />)
    expect(screen.queryByRole('list', { name: /Movimentações do dia/ })).toBeNull()
    expect(screen.getByText(/Sem cotação com fechamento anterior/)).toBeTruthy()
  })
})

describe('Início: falha ao criar o gráfico', () => {
  it('registra o erro no console e segue com a legenda e o resumo em texto', () => {
    const erro = new Error('configuração inválida')
    graficos.falha.erro = erro
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Inicio dados={carteira()} agora={AGORA} />)).not.toThrow()

    // Um registro por gráfico que falhou (rosca e linha), sempre com o erro original.
    expect(console_).toHaveBeenCalledTimes(2)
    for (const chamada of console_.mock.calls) {
      expect(chamada[0]).toMatch(/Não foi possível desenhar o gráfico/)
      expect(chamada[1]).toBe(erro)
    }
    // Nada foi criado, mas o conteúdo em texto continua inteiro.
    expect(graficos.criados).toHaveLength(0)
    const legenda = screen.getByRole('list', { name: /Composição da carteira/ })
    expect(within(legenda).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByTestId('resumo-evolucao').textContent).toContain('R$ 2.700,00')
  })

  it('desmontar depois da falha não lança', () => {
    graficos.falha.erro = new Error('falhou')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<Inicio dados={carteira()} agora={AGORA} />)
    expect(() => unmount()).not.toThrow()
  })
})
