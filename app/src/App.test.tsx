import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { ClienteAuth } from './lib/supabase'
import { ativo, cotacao, dadosCarteira } from './teste/fixtures'

// O jsdom não tem canvas: o Início, que desenha gráficos, usa um Chart de mentira aqui.
vi.mock('chart.js', () => {
  class Chart {
    static register = vi.fn()
    destroy() {}
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

const vazia = () => Promise.resolve(dadosCarteira())

function authSimulado(sessao: unknown) {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session: sessao }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as ClienteAuth
}

describe('App', () => {
  it('sem sessão só renderiza o Login', async () => {
    render(<App auth={authSimulado(null)} carregarDados={vazia} />)
    expect(await screen.findByLabelText('E-mail')).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
  })

  it('com sessão mostra o menu e a tela inicial, sem o Login', async () => {
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={vazia} />)
    expect(await screen.findByRole('navigation')).toBeTruthy()
    expect(screen.queryByLabelText('E-mail')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Início')
  })

  it('a rota Importar mostra o seletor de planilha', async () => {
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={vazia} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Importar' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Importar')
    expect(screen.getByLabelText('Escolher planilha')).toBeTruthy()
  })

  it('troca de tela pelo menu', async () => {
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={vazia} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativos' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ativos')
  })

  it('Ativos: carrega a carteira uma vez e mostra a tela com os dados', async () => {
    const carregar = vi.fn().mockResolvedValue(
      dadosCarteira({
        ativos: [ativo({ quantidade: 7 })],
        cotacoes: { FIIA11: cotacao({ preco: 87.35, as_of: new Date().toISOString() }) },
      }),
    )
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={carregar} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativos' }))
    expect(await screen.findByText('FIIA11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Início' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ativos' }))
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('Início: o botão Atualizar relê a carteira sem tirar os dados da tela; se falhar, avisa e mantém', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {})
    const carteira = (qtd: number) =>
      dadosCarteira({
        ativos: [ativo({ quantidade: qtd })],
        cotacoes: { FIIA11: cotacao({ preco: 10, as_of: new Date().toISOString() }) },
      })
    const carregar = vi
      .fn()
      .mockResolvedValueOnce(carteira(7))
      .mockResolvedValueOnce(carteira(8))
      .mockRejectedValueOnce(new Error('sem rede'))
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={carregar} />)
    expect((await screen.findByTestId('patrimonio')).textContent).toBe('R$ 70,00')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(screen.getByTestId('patrimonio').textContent).toBe('R$ 80,00'))
    expect(carregar).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(await screen.findByText('Não foi possível atualizar agora.')).toBeTruthy()
    expect(screen.getByTestId('patrimonio').textContent).toBe('R$ 80,00')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(espiao).toHaveBeenCalledTimes(1)
    espiao.mockRestore()
  })

  it('Ativos: falha ao carregar mostra o erro e deixa tentar de novo (nunca uma carteira vazia)', async () => {
    const carregar = vi
      .fn()
      .mockRejectedValueOnce(new Error('Não foi possível carregar ativos: sem rede.'))
      .mockResolvedValueOnce(dadosCarteira())
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={carregar} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativos' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/sem rede/)
    expect(screen.queryByText(/Nenhum ativo/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByText('Nenhum ativo ainda. Importe sua carteira.')).toBeTruthy()
  })

  it('carteira vazia em Ativos leva para Importar', async () => {
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={vazia} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativos' }))
    fireEvent.click(await screen.findByRole('button', { name: /Ir para Importar/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Importar')
  })

  it('Início: carrega a carteira e mostra o patrimônio', async () => {
    const carregar = vi.fn().mockResolvedValue(
      dadosCarteira({
        ativos: [ativo({ quantidade: 7 })],
        cotacoes: { FIIA11: cotacao({ preco: 100, prev_close: 90, as_of: new Date().toISOString() }) },
      }),
    )
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={carregar} />)
    expect((await screen.findByTestId('patrimonio')).textContent).toBe('R$ 700,00')
    expect(screen.getByTestId('variacao-dia').textContent).toContain('+R$ 70,00')
  })

  it('carteira vazia no Início leva para Importar', async () => {
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={vazia} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ir para Importar/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Importar')
  })

  it('Proventos: mostra os ativos de bolsa com o que o coletor trouxe', async () => {
    const carregar = vi.fn().mockResolvedValue(
      dadosCarteira({
        ativos: [ativo({ codigo: 'FIIA11' })],
        cotacoes: {
          FIIA11: cotacao({
            as_of: new Date().toISOString(),
            dy_12m_pct: 9.37,
            ultimo_rendimento: { valor: 0.09, data: '2026-10-15' },
          }),
        },
      }),
    )
    render(<App auth={authSimulado({ access_token: 'x' })} carregarDados={carregar} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Proventos' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Proventos')
    expect(await screen.findByText('9,37%')).toBeTruthy()
    expect(screen.getByText('15/10/2026')).toBeTruthy()
  })

  it('Configurações: mostra os alvos e o Sair encerra a sessão', async () => {
    const auth = authSimulado({ access_token: 'x' })
    const carregar = vi.fn().mockResolvedValue(dadosCarteira({ ativos: [ativo({ alvo_pct: 40 })] }))
    render(<App auth={auth} carregarDados={carregar} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Configurações' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Configurações')
    expect(((await screen.findByLabelText('Alvo de FIIA11 (%)')) as HTMLInputElement).value).toBe('40')
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })
})
