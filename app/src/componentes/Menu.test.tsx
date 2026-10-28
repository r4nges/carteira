import { act, fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import { simularLargura } from '../teste/setup'
import { Menu } from './Menu'

const ROTULOS = ['Início', 'Ativos', 'Proventos', 'Importar', 'Configurações']

describe('Menu', () => {
  it('mostra as cinco rotas em pt-BR', () => {
    render(<Menu rota="inicio" aoNavegar={() => {}} />)
    const botoes = screen.getAllByRole('button')
    expect(botoes.map((b) => b.textContent)).toEqual(ROTULOS)
  })

  it('marca a rota atual com aria-current', () => {
    render(<Menu rota="ativos" aoNavegar={() => {}} />)
    expect(screen.getByRole('button', { name: 'Ativos' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Início' }).hasAttribute('aria-current')).toBe(false)
  })

  it('avisa a rota escolhida', () => {
    const aoNavegar = vi.fn()
    render(<Menu rota="inicio" aoNavegar={aoNavegar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(aoNavegar).toHaveBeenCalledWith('config')
  })

  it('vira barra lateral a partir de 900 px', () => {
    simularLargura(900)
    render(<Menu rota="inicio" aoNavegar={() => {}} />)
    const nav = screen.getByRole('navigation')
    expect(nav.getAttribute('data-layout')).toBe('lateral')
    expect(nav.classList.contains('menu--lateral')).toBe(true)
  })

  it('vira barra inferior abaixo de 900 px', () => {
    simularLargura(899)
    render(<Menu rota="inicio" aoNavegar={() => {}} />)
    const nav = screen.getByRole('navigation')
    expect(nav.getAttribute('data-layout')).toBe('inferior')
    expect(nav.classList.contains('menu--inferior')).toBe(true)
  })

  it('troca de disposição quando a largura muda', () => {
    const tela = simularLargura(1200)
    render(<Menu rota="inicio" aoNavegar={() => {}} />)
    const nav = screen.getByRole('navigation')
    expect(nav.getAttribute('data-layout')).toBe('lateral')
    act(() => tela.redimensionar(600))
    expect(nav.getAttribute('data-layout')).toBe('inferior')
    act(() => tela.redimensionar(900))
    expect(nav.getAttribute('data-layout')).toBe('lateral')
  })
})
