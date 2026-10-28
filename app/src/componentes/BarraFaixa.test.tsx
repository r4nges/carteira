import { render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { BarraFaixa } from './BarraFaixa'

describe('BarraFaixa', () => {
  it('descreve a posição na faixa de 52 semanas para leitor de tela', () => {
    render(<BarraFaixa posicao={64.2} min={6.27} max={7.84} />)
    const barra = screen.getByRole('img')
    expect(barra.getAttribute('aria-label')).toMatch(/^posição na faixa de 52 semanas: 64%/)
    expect(barra.getAttribute('aria-label')).toMatch(/mínima R\$ 6,27/)
    expect(barra.getAttribute('aria-label')).toMatch(/máxima R\$ 7,84/)
  })

  it('mostra os extremos como texto', () => {
    const { container } = render(<BarraFaixa posicao={50} min={10} max={20} />)
    expect(container.textContent).toContain('10,00')
    expect(container.textContent).toContain('20,00')
  })

  it('o marcador fica na posição (em %)', () => {
    const { container } = render(<BarraFaixa posicao={40} min={1} max={2} />)
    const marcador = container.querySelector('.faixa__marcador') as HTMLElement
    expect(marcador.style.left).toBe('40%')
  })

  it('limita o marcador entre 0 e 100', () => {
    const { container, rerender } = render(<BarraFaixa posicao={140} min={1} max={2} />)
    expect((container.querySelector('.faixa__marcador') as HTMLElement).style.left).toBe('100%')
    rerender(<BarraFaixa posicao={-20} min={1} max={2} />)
    expect((container.querySelector('.faixa__marcador') as HTMLElement).style.left).toBe('0%')
  })

  it('sem posição: não desenha a barra e avisa que não há faixa', () => {
    const { container } = render(<BarraFaixa posicao={null} min={null} max={null} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.textContent).toMatch(/sem faixa de 52 semanas/i)
  })

  it('posição não finita é tratada como ausente', () => {
    const { container } = render(<BarraFaixa posicao={Number.NaN} min={1} max={2} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('extremos ausentes: barra sem rótulos de mínimo e máximo', () => {
    const { container } = render(<BarraFaixa posicao={30} min={null} max={undefined} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('posição na faixa de 52 semanas: 30%')
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })
})
