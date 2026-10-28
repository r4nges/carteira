import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ativo, dadosCarteira } from '../teste/fixtures'
import { CarregaDados, DadosProvider, useDados } from './dados'
import type { DadosCarteira } from './banco'

function Sonda() {
  const { estado, dados, erro, recarregar } = useDados()
  return (
    <div>
      <p data-testid="estado">{estado}</p>
      <p data-testid="qtd">{dados ? dados.ativos.length : 'sem dados'}</p>
      <p data-testid="erro">{erro ?? 'sem erro'}</p>
      <button type="button" onClick={recarregar}>
        recarregar
      </button>
    </div>
  )
}

const umAtivo = () => dadosCarteira({ ativos: [ativo()] })

describe('DadosProvider', () => {
  it('carrega uma vez ao montar: carregando, depois pronto com os dados', async () => {
    const carregar = vi.fn().mockResolvedValue(umAtivo())
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    expect(screen.getByTestId('estado').textContent).toBe('carregando')
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('pronto'))
    expect(screen.getByTestId('qtd').textContent).toBe('1')
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('erro: expõe a mensagem, não expõe dados (nunca uma carteira vazia)', async () => {
    const carregar = vi.fn().mockRejectedValue(new Error('Não foi possível carregar ativos: sem rede.'))
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('erro'))
    expect(screen.getByTestId('erro').textContent).toBe('Não foi possível carregar ativos: sem rede.')
    expect(screen.getByTestId('qtd').textContent).toBe('sem dados')
  })

  it('erro que não é Error vira mensagem genérica em pt-BR', async () => {
    const carregar = vi.fn().mockRejectedValue('x')
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('erro'))
    expect(screen.getByTestId('erro').textContent).toMatch(/Não foi possível carregar/)
  })

  it('recarregar busca de novo e atualiza os dados', async () => {
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(umAtivo())
      .mockResolvedValueOnce(dadosCarteira({ ativos: [ativo(), ativo({ codigo: 'FIIB11' })] }))
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('qtd').textContent).toBe('1'))
    fireEvent.click(screen.getByRole('button', { name: 'recarregar' }))
    await waitFor(() => expect(screen.getByTestId('qtd').textContent).toBe('2'))
    expect(carregar).toHaveBeenCalledTimes(2)
  })

  it('recarregar depois de um erro volta a carregar e fica pronto', async () => {
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce(umAtivo())
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('erro'))
    fireEvent.click(screen.getByRole('button', { name: 'recarregar' }))
    await waitFor(() => expect(screen.getByTestId('estado').textContent).toBe('pronto'))
    expect(screen.getByTestId('erro').textContent).toBe('sem erro')
  })

  it('resposta antiga não sobrescreve a mais nova', async () => {
    let resolverPrimeira!: (d: DadosCarteira) => void
    const primeira = new Promise<DadosCarteira>((r) => (resolverPrimeira = r))
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockReturnValueOnce(primeira)
      .mockResolvedValueOnce(dadosCarteira({ ativos: [ativo(), ativo({ codigo: 'FIIB11' })] }))
    render(
      <DadosProvider carregar={carregar}>
        <Sonda />
      </DadosProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'recarregar' }))
    await waitFor(() => expect(screen.getByTestId('qtd').textContent).toBe('2'))
    resolverPrimeira(umAtivo())
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.getByTestId('qtd').textContent).toBe('2')
  })

  it('useDados fora do provider avisa com erro claro', () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Sonda />)).toThrow(/DadosProvider/)
    espiao.mockRestore()
  })
})

describe('CarregaDados', () => {
  it('mostra "carregando" e depois os filhos com os dados', async () => {
    const carregar = vi.fn().mockResolvedValue(umAtivo())
    render(
      <DadosProvider carregar={carregar}>
        <CarregaDados>{(d) => <p>{d.ativos.length} ativo(s)</p>}</CarregaDados>
      </DadosProvider>,
    )
    expect(screen.getByRole('status').textContent).toMatch(/Carregando/)
    expect(await screen.findByText('1 ativo(s)')).toBeTruthy()
  })

  it('erro: mostra a mensagem e o botão de tentar de novo, sem renderizar os filhos', async () => {
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockRejectedValueOnce(new Error('Não foi possível carregar ativos: sem rede.'))
      .mockResolvedValueOnce(umAtivo())
    const filhos = vi.fn((d: DadosCarteira) => <p>{d.ativos.length} ativo(s)</p>)
    render(
      <DadosProvider carregar={carregar}>
        <CarregaDados>{filhos}</CarregaDados>
      </DadosProvider>,
    )
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(/sem rede/)
    expect(filhos).not.toHaveBeenCalled()
    expect(screen.queryByText(/Nenhum ativo/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByText('1 ativo(s)')).toBeTruthy()
    expect(carregar).toHaveBeenCalledTimes(2)
  })
})

describe('DadosProvider: atualização automática', () => {
  const CINCO_MIN = 5 * 60_000

  function SondaAuto() {
    const { estado, dados, erro, atualizar, atualizando, falhaAtualizar } = useDados()
    return (
      <div>
        <p data-testid="estado">{estado}</p>
        <p data-testid="qtd">{dados ? dados.ativos.length : 'sem dados'}</p>
        <p data-testid="erro">{erro ?? 'sem erro'}</p>
        <p data-testid="atualizando">{String(atualizando)}</p>
        <p data-testid="falha">{String(falhaAtualizar)}</p>
        <button type="button" onClick={atualizar}>
          atualizar
        </button>
      </div>
    )
  }

  const comN = (n: number) =>
    dadosCarteira({ ativos: Array.from({ length: n }, (_, i) => ativo({ codigo: `ATV${i + 1}` })) })

  function definirVisibilidade(valor: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => valor })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  /** Deixa as promessas pendentes terminarem sem avançar o relógio falso. */
  const drenar = () => act(async () => {})
  const avancar = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  async function montar(carregar: () => Promise<DadosCarteira>) {
    vi.useFakeTimers()
    const r = render(
      <DadosProvider carregar={carregar}>
        <SondaAuto />
      </DadosProvider>,
    )
    await drenar()
    expect(screen.getByTestId('estado').textContent).toBe('pronto')
    return r
  }

  afterEach(() => {
    // Remove a propriedade criada no teste e volta ao getter do protótipo.
    delete (document as unknown as Record<string, unknown>).visibilityState
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('volta à aba com os dados de menos de 5 min: não recarrega', async () => {
    const carregar = vi.fn<() => Promise<DadosCarteira>>().mockResolvedValue(comN(1))
    await montar(carregar)
    await avancar(CINCO_MIN - 1000)
    act(() => definirVisibilidade('hidden'))
    act(() => definirVisibilidade('visible'))
    await drenar()
    expect(carregar).toHaveBeenCalledTimes(1)
  })

  it('volta à aba com os dados de mais de 5 min: recarrega sem tirar os dados da tela', async () => {
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockResolvedValueOnce(comN(2))
    await montar(carregar)
    act(() => definirVisibilidade('hidden'))
    await avancar(CINCO_MIN + 1000)
    expect(carregar).toHaveBeenCalledTimes(1) // escondida: nada de relógio
    act(() => definirVisibilidade('visible'))
    // Durante a leitura, os dados antigos continuam e o estado nunca volta a "carregando".
    expect(screen.getByTestId('estado').textContent).toBe('pronto')
    expect(screen.getByTestId('qtd').textContent).toBe('1')
    expect(screen.getByTestId('atualizando').textContent).toBe('true')
    await drenar()
    expect(carregar).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('qtd').textContent).toBe('2')
    expect(screen.getByTestId('atualizando').textContent).toBe('false')
  })

  it('com a aba visível, recarrega a cada 5 min; escondida, não', async () => {
    const carregar = vi.fn<() => Promise<DadosCarteira>>().mockImplementation(async () => comN(1))
    await montar(carregar)
    await avancar(CINCO_MIN - 1)
    expect(carregar).toHaveBeenCalledTimes(1)
    await avancar(1)
    expect(carregar).toHaveBeenCalledTimes(2)
    await avancar(CINCO_MIN)
    expect(carregar).toHaveBeenCalledTimes(3)
    act(() => definirVisibilidade('hidden'))
    await avancar(CINCO_MIN * 3)
    expect(carregar).toHaveBeenCalledTimes(3)
  })

  it('falha silenciosa: mantém os dados, registra no console e não mostra erro; a próxima leitura limpa a falha', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {})
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockRejectedValueOnce(new Error('sem rede'))
      .mockResolvedValueOnce(comN(3))
    await montar(carregar)
    await avancar(CINCO_MIN)
    expect(espiao).toHaveBeenCalledTimes(1)
    expect(String(espiao.mock.calls[0][0])).toMatch(/Falha ao atualizar/)
    expect(screen.getByTestId('estado').textContent).toBe('pronto')
    expect(screen.getByTestId('qtd').textContent).toBe('1')
    expect(screen.getByTestId('erro').textContent).toBe('sem erro')
    expect(screen.getByTestId('falha').textContent).toBe('true')
    expect(screen.getByTestId('atualizando').textContent).toBe('false')
    await avancar(CINCO_MIN)
    expect(screen.getByTestId('qtd').textContent).toBe('3')
    expect(screen.getByTestId('falha').textContent).toBe('false')
  })

  it('atualizar (botão) recarrega na hora, sem esperar o intervalo', async () => {
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockResolvedValueOnce(comN(4))
    await montar(carregar)
    fireEvent.click(screen.getByRole('button', { name: 'atualizar' }))
    await drenar()
    expect(screen.getByTestId('qtd').textContent).toBe('4')
    expect(screen.getByTestId('estado').textContent).toBe('pronto')
  })

  it('resposta antiga de uma atualização não sobrescreve a mais nova', async () => {
    let resolverLenta!: (d: DadosCarteira) => void
    const lenta = new Promise<DadosCarteira>((r) => (resolverLenta = r))
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockReturnValueOnce(lenta)
      .mockResolvedValueOnce(comN(5))
    await montar(carregar)
    await avancar(CINCO_MIN) // dispara a lenta
    expect(screen.getByTestId('atualizando').textContent).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'atualizar' })) // dispara a rápida
    await drenar()
    expect(screen.getByTestId('qtd').textContent).toBe('5')
    resolverLenta(comN(2))
    await drenar()
    expect(screen.getByTestId('qtd').textContent).toBe('5')
    expect(screen.getByTestId('atualizando').textContent).toBe('false')
  })

  it('falha de uma leitura antiga não derruba a tela depois de uma leitura nova que deu certo', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejeitarLenta!: (e: Error) => void
    const lenta = new Promise<DadosCarteira>((_, r) => (rejeitarLenta = r))
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockReturnValueOnce(lenta)
      .mockResolvedValueOnce(comN(5))
    await montar(carregar)
    await avancar(CINCO_MIN)
    fireEvent.click(screen.getByRole('button', { name: 'atualizar' }))
    await drenar()
    rejeitarLenta(new Error('tarde demais'))
    await drenar()
    expect(screen.getByTestId('qtd').textContent).toBe('5')
    expect(screen.getByTestId('falha').textContent).toBe('false')
    expect(espiao).not.toHaveBeenCalled()
  })

  it('ao desmontar: remove o ouvinte, para o relógio e descarta a resposta pendente', async () => {
    let resolverLenta!: (d: DadosCarteira) => void
    const lenta = new Promise<DadosCarteira>((r) => (resolverLenta = r))
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockResolvedValueOnce(comN(1))
      .mockReturnValueOnce(lenta)
    const { unmount } = await montar(carregar)
    await avancar(CINCO_MIN)
    expect(carregar).toHaveBeenCalledTimes(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => definirVisibilidade('hidden'))
    act(() => definirVisibilidade('visible'))
    await avancar(CINCO_MIN * 3)
    expect(carregar).toHaveBeenCalledTimes(2)
    resolverLenta(comN(2))
    await drenar() // sem erro de atualização de componente desmontado
  })

  it('carga inicial que falhou: ao voltar à aba, tenta de novo pelo fluxo normal', async () => {
    vi.useFakeTimers()
    const carregar = vi
      .fn<() => Promise<DadosCarteira>>()
      .mockRejectedValueOnce(new Error('sem rede'))
      .mockResolvedValueOnce(comN(2))
    render(
      <DadosProvider carregar={carregar}>
        <SondaAuto />
      </DadosProvider>,
    )
    await drenar()
    expect(screen.getByTestId('estado').textContent).toBe('erro')
    act(() => definirVisibilidade('hidden'))
    act(() => definirVisibilidade('visible'))
    await drenar()
    expect(screen.getByTestId('estado').textContent).toBe('pronto')
    expect(screen.getByTestId('qtd').textContent).toBe('2')
  })
})
