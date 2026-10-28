import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import type { DadosCarteira } from '../lib/banco'
import { ativo, dadosCarteira } from '../teste/fixtures'
import { Configuracoes } from './Configuracoes'

function carteira(p: Partial<DadosCarteira> = {}): DadosCarteira {
  return dadosCarteira({
    ativos: [
      ativo({ codigo: 'FIIA11', tipo: 'FII', alvo_pct: 60 }),
      ativo({ codigo: 'FIIB11', tipo: 'FII', alvo_pct: 40 }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: null }),
    ],
    ...p,
  })
}

function montar(dados = carteira(), p: Partial<Parameters<typeof Configuracoes>[0]> = {}) {
  const props = {
    dados,
    salvarAlvos: vi.fn().mockResolvedValue(undefined),
    salvarLimites: vi.fn().mockResolvedValue(undefined),
    aoSalvar: vi.fn(),
    aoSair: vi.fn(),
    ...p,
  }
  render(<Configuracoes {...props} />)
  return props
}

const campoAlvo = (codigo: string) => screen.getByLabelText(`Alvo de ${codigo} (%)`) as HTMLInputElement
const digitar = (campo: HTMLElement, valor: string) => fireEvent.input(campo, { target: { value: valor } })
const botaoAlvos = () => screen.getByRole('button', { name: /Salvar alvos|Salvando alvos/ }) as HTMLButtonElement
const botaoLimites = () => screen.getByRole('button', { name: /Salvar limites|Salvando limites/ }) as HTMLButtonElement
const campoLimite = (nome: string) => screen.getByLabelText(nome) as HTMLInputElement

describe('Configurações: alvos', () => {
  it('um campo por ativo, com o alvo atual (vazio quando não há)', () => {
    montar()
    expect(campoAlvo('FIIA11').value).toBe('60')
    expect(campoAlvo('FIIB11').value).toBe('40')
    expect(campoAlvo('ACAO4').value).toBe('')
  })

  it('alvo decimal aparece com vírgula', () => {
    montar(carteira({ ativos: [ativo({ codigo: 'FIIA11', alvo_pct: 12.5 })] }))
    expect(campoAlvo('FIIA11').value).toBe('12,5')
  })

  it('soma 100: informa sem avisar', () => {
    montar()
    expect(screen.getByText('Os alvos somam 100%.')).toBeTruthy()
    expect(screen.queryByText(/não 100%/)).toBeNull()
  })

  it('soma 101 mostra o aviso, mas permite salvar', async () => {
    const p = montar()
    digitar(campoAlvo('FIIB11'), '41')
    expect(screen.getByText('Os alvos somam 101%, não 100%.')).toBeTruthy()
    expect(botaoAlvos().disabled).toBe(false)
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ FIIB11: 41 }))
  })

  it('a soma é ao vivo e usa vírgula nos decimais (100,5%)', () => {
    montar()
    digitar(campoAlvo('FIIA11'), '60,5')
    expect(screen.getByText('Os alvos somam 100,5%, não 100%.')).toBeTruthy()
    digitar(campoAlvo('FIIA11'), '50')
    expect(screen.getByText('Os alvos somam 90%, não 100%.')).toBeTruthy()
  })

  it('não acumula erro de ponto flutuante na soma (0,1 + 0,2 + 99,7)', () => {
    montar(carteira({ ativos: [ativo({ codigo: 'FIIA11' }), ativo({ codigo: 'FIIB11' }), ativo({ codigo: 'ACAO4' })] }))
    digitar(campoAlvo('FIIA11'), '0,1')
    digitar(campoAlvo('FIIB11'), '0,2')
    digitar(campoAlvo('ACAO4'), '99,7')
    expect(screen.getByText('Os alvos somam 100%.')).toBeTruthy()
  })

  it('ativo sem alvo fica fora da soma', () => {
    montar()
    // ACAO4 sem alvo: soma continua 60 + 40.
    expect(screen.getByText('Os alvos somam 100%.')).toBeTruthy()
    digitar(campoAlvo('FIIB11'), '')
    expect(screen.getByText('Os alvos somam 60%, não 100%.')).toBeTruthy()
  })

  it('nenhum alvo definido: não cobra 100%', () => {
    montar(carteira({ ativos: [ativo({ codigo: 'FIIA11' })] }))
    expect(screen.getByText('Nenhum alvo definido.')).toBeTruthy()
    expect(screen.queryByText(/não 100%/)).toBeNull()
  })

  it('aceita decimal com vírgula e grava o número', async () => {
    const p = montar()
    digitar(campoAlvo('ACAO4'), '12,5')
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ ACAO4: 12.5 }))
  })

  it('aceita decimal com ponto', async () => {
    const p = montar()
    digitar(campoAlvo('ACAO4'), '12.5')
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ ACAO4: 12.5 }))
  })

  it('campo vazio salva null', async () => {
    const p = montar()
    digitar(campoAlvo('FIIA11'), '')
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ FIIA11: null }))
  })

  it('campo só com espaços conta como vazio', async () => {
    const p = montar()
    digitar(campoAlvo('FIIA11'), '   ')
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ FIIA11: null }))
  })

  it('sem nenhuma mudança o botão fica desabilitado', () => {
    montar()
    expect(botaoAlvos().disabled).toBe(true)
  })

  it('voltar ao valor original desfaz a mudança', () => {
    montar()
    digitar(campoAlvo('FIIA11'), '50')
    expect(botaoAlvos().disabled).toBe(false)
    digitar(campoAlvo('FIIA11'), '60,0')
    expect(botaoAlvos().disabled).toBe(true)
  })

  it.each([
    ['-5', 'O alvo não pode ser negativo.'],
    ['100,5', 'O alvo não pode passar de 100%.'],
    ['101', 'O alvo não pode passar de 100%.'],
    ['abc', 'Use um número, como 12,5.'],
    ['NaN', 'Use um número, como 12,5.'],
    ['Infinity', 'Use um número, como 12,5.'],
    ['1e3', 'Use um número, como 12,5.'],
    ['1,2,3', 'Use um número, como 12,5.'],
  ])('alvo %j é recusado com erro no campo e não salva', (texto, mensagem) => {
    const p = montar()
    digitar(campoAlvo('ACAO4'), texto)
    const campo = campoAlvo('ACAO4')
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    const id = campo.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const erro = document.getElementById(id!)!
    expect(erro.textContent).toBe(mensagem)
    expect(erro.getAttribute('role')).toBe('alert')
    expect(botaoAlvos().disabled).toBe(true)
    fireEvent.click(botaoAlvos())
    expect(p.salvarAlvos).not.toHaveBeenCalled()
  })

  it('0 e 100 são válidos', async () => {
    const p = montar()
    digitar(campoAlvo('ACAO4'), '0')
    digitar(campoAlvo('FIIA11'), '100')
    expect(botaoAlvos().disabled).toBe(false)
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(p.salvarAlvos).toHaveBeenCalledWith({ ACAO4: 0, FIIA11: 100 }))
  })

  it('um campo inválido bloqueia o salvamento de todos, e o erro some ao corrigir', () => {
    montar()
    digitar(campoAlvo('FIIA11'), '50')
    digitar(campoAlvo('ACAO4'), '-1')
    expect(botaoAlvos().disabled).toBe(true)
    digitar(campoAlvo('ACAO4'), '10')
    expect(campoAlvo('ACAO4').getAttribute('aria-invalid')).toBeNull()
    expect(botaoAlvos().disabled).toBe(false)
  })

  it('campo inválido fica fora da soma ao vivo', () => {
    montar()
    digitar(campoAlvo('ACAO4'), '-9')
    expect(screen.getByText('Os alvos somam 100%.')).toBeTruthy()
  })

  it('sucesso: avisa, recarrega os dados e desabilita o botão enquanto salva', async () => {
    let resolver!: () => void
    const salvarAlvos = vi.fn(() => new Promise<void>((r) => (resolver = r)))
    const p = montar(carteira(), { salvarAlvos })
    digitar(campoAlvo('FIIA11'), '50')
    fireEvent.click(botaoAlvos())
    await waitFor(() => expect(botaoAlvos().disabled).toBe(true))
    expect(botaoAlvos().textContent).toBe('Salvando alvos…')
    fireEvent.click(botaoAlvos())
    expect(salvarAlvos).toHaveBeenCalledTimes(1)
    resolver()
    expect((await screen.findByText('Alvos salvos.')).closest('[role="status"]')).toBeTruthy()
    expect(p.aoSalvar).toHaveBeenCalledTimes(1)
  })

  it('falha: mostra o erro (alert) e recarrega, porque o salvamento não é atômico', async () => {
    const salvarAlvos = vi.fn().mockRejectedValue(new Error('Não foi possível salvar o alvo de FIIB11: sem permissão.'))
    const p = montar(carteira(), { salvarAlvos })
    digitar(campoAlvo('FIIA11'), '50')
    fireEvent.click(botaoAlvos())
    const alerta = await screen.findByText(/Não foi possível salvar o alvo de FIIB11/)
    expect(alerta.closest('[role="alert"]')).toBeTruthy()
    expect(p.aoSalvar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Alvos salvos.')).toBeNull()
    expect(botaoAlvos().disabled).toBe(false)
    // O que o usuário digitou continua na tela para tentar de novo.
    expect(campoAlvo('FIIA11').value).toBe('50')
  })

  it('falha sem mensagem usa o texto padrão em pt-BR', async () => {
    const salvarAlvos = vi.fn().mockRejectedValue('x')
    montar(carteira(), { salvarAlvos })
    digitar(campoAlvo('FIIA11'), '50')
    fireEvent.click(botaoAlvos())
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível salvar os alvos/)
  })

  it('sem ativos: avisa e não mostra o botão de alvos', () => {
    montar(dadosCarteira())
    expect(screen.getByText(/Nenhum ativo ainda/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Salvar alvos/ })).toBeNull()
  })
})

describe('Configurações: limites do selo', () => {
  it('mostra os limites atuais', () => {
    montar()
    expect(campoLimite('Barato até (%)').value).toBe('25')
    expect(campoLimite('No meio até (%)').value).toBe('75')
    expect(campoLimite('Perto do teto até (%)').value).toBe('90')
  })

  it('salva limites válidos, com decimais em vírgula', async () => {
    const p = montar()
    digitar(campoLimite('Barato até (%)'), '20,5')
    digitar(campoLimite('No meio até (%)'), '60')
    digitar(campoLimite('Perto do teto até (%)'), '85')
    fireEvent.click(botaoLimites())
    await waitFor(() => expect(p.salvarLimites).toHaveBeenCalledWith({ barato: 20.5, meio: 60, teto: 85 }))
    expect(await screen.findByText('Limites salvos.')).toBeTruthy()
    expect(p.aoSalvar).toHaveBeenCalledTimes(1)
  })

  it('sem mudança o botão fica desabilitado', () => {
    montar()
    expect(botaoLimites().disabled).toBe(true)
  })

  it.each([
    ['80', '50', '90'],
    ['50', '50', '90'],
    ['25', '90', '90'],
    ['25', '95', '90'],
  ])('fora de ordem (%s / %s / %s) é recusado com mensagem', (b, m, t) => {
    const p = montar()
    digitar(campoLimite('Barato até (%)'), b)
    digitar(campoLimite('No meio até (%)'), m)
    digitar(campoLimite('Perto do teto até (%)'), t)
    const alerta = screen.getByText('Os limites precisam estar em ordem crescente: barato < meio < teto.')
    expect(alerta.getAttribute('role')).toBe('alert')
    expect(botaoLimites().disabled).toBe(true)
    fireEvent.click(botaoLimites())
    expect(p.salvarLimites).not.toHaveBeenCalled()
  })

  it.each([
    ['-1', '75', '90'],
    ['25', '75', '101'],
  ])('fora de 0 a 100 (%s / %s / %s) é recusado', (b, m, t) => {
    const p = montar()
    digitar(campoLimite('Barato até (%)'), b)
    digitar(campoLimite('No meio até (%)'), m)
    digitar(campoLimite('Perto do teto até (%)'), t)
    expect(screen.getByText('Cada limite precisa ser um número entre 0 e 100.')).toBeTruthy()
    expect(botaoLimites().disabled).toBe(true)
    expect(p.salvarLimites).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', 'NaN'])('valor %j num limite é recusado (vazio não vira 0)', (texto) => {
    const p = montar()
    digitar(campoLimite('Barato até (%)'), texto)
    const campo = campoLimite('Barato até (%)')
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(campo.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Cada limite precisa ser um número entre 0 e 100.',
    )
    expect(botaoLimites().disabled).toBe(true)
    expect(p.salvarLimites).not.toHaveBeenCalled()
  })

  it('aceita os extremos 0 e 100', async () => {
    const p = montar()
    digitar(campoLimite('Barato até (%)'), '0')
    digitar(campoLimite('Perto do teto até (%)'), '100')
    fireEvent.click(botaoLimites())
    await waitFor(() => expect(p.salvarLimites).toHaveBeenCalledWith({ barato: 0, meio: 75, teto: 100 }))
  })

  it('falha ao salvar mostra o erro e não diz que salvou', async () => {
    const salvarLimites = vi.fn().mockRejectedValue(new Error('Não foi possível salvar limites: sem rede.'))
    const p = montar(carteira(), { salvarLimites })
    digitar(campoLimite('Barato até (%)'), '20')
    fireEvent.click(botaoLimites())
    const alerta = await screen.findByText(/Não foi possível salvar limites/)
    expect(alerta.closest('[role="alert"]')).toBeTruthy()
    expect(screen.queryByText('Limites salvos.')).toBeNull()
    expect(p.aoSalvar).not.toHaveBeenCalled()
    expect(botaoLimites().disabled).toBe(false)
  })

  it('desabilita o botão enquanto salva e não envia duas vezes', async () => {
    let resolver!: () => void
    const salvarLimites = vi.fn(() => new Promise<void>((r) => (resolver = r)))
    montar(carteira(), { salvarLimites })
    digitar(campoLimite('Barato até (%)'), '20')
    fireEvent.click(botaoLimites())
    await waitFor(() => expect(botaoLimites().disabled).toBe(true))
    fireEvent.click(botaoLimites())
    expect(salvarLimites).toHaveBeenCalledTimes(1)
    resolver()
    await screen.findByText('Limites salvos.')
  })

  it('descreve as faixas do selo com os limites digitados, sem recomendar nada', () => {
    montar()
    digitar(campoLimite('Barato até (%)'), '20')
    const texto = document.body.textContent!
    expect(texto).toContain('Barato até 20%')
    expect(texto).not.toMatch(/compre|venda|recomend/i)
  })
})

describe('Configurações: Sair', () => {
  it('o botão Sair chama aoSair', () => {
    const p = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(p.aoSair).toHaveBeenCalledTimes(1)
  })
})
