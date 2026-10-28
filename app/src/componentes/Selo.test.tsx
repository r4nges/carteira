import { render, screen } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { LIMITES_PADRAO } from '../lib/metricas'
import { Selo } from './Selo'

describe('Selo', () => {
  it('usa o texto como sinal (não só a cor), um por faixa', () => {
    const casos: [number, string][] = [
      [10, 'Barato'],
      [50, 'No meio'],
      [80, 'Perto do teto'],
      [95, 'Esticado'],
    ]
    for (const [posicao, texto] of casos) {
      const { unmount } = render(<Selo posicao={posicao} limites={LIMITES_PADRAO} />)
      expect(screen.getByText(texto)).toBeTruthy()
      unmount()
    }
  })

  it('muda com os limites da configuração', () => {
    const { rerender } = render(<Selo posicao={40} limites={LIMITES_PADRAO} />)
    expect(screen.getByText('No meio')).toBeTruthy()
    rerender(<Selo posicao={40} limites={{ barato: 45, meio: 60, teto: 90 }} />)
    expect(screen.getByText('Barato')).toBeTruthy()
    rerender(<Selo posicao={40} limites={{ barato: 10, meio: 20, teto: 30 }} />)
    expect(screen.getByText('Esticado')).toBeTruthy()
  })

  it('cada selo tem uma classe própria para o estilo', () => {
    const { container } = render(<Selo posicao={95} limites={LIMITES_PADRAO} />)
    expect(container.querySelector('.selo--esticado')).toBeTruthy()
  })

  it('sem posição (null/undefined/NaN): não renderiza nada', () => {
    const a = render(<Selo posicao={null} limites={LIMITES_PADRAO} />)
    expect(a.container.textContent).toBe('')
    a.unmount()
    const b = render(<Selo posicao={undefined} limites={LIMITES_PADRAO} />)
    expect(b.container.textContent).toBe('')
    b.unmount()
    const c = render(<Selo posicao={Number.NaN} limites={LIMITES_PADRAO} />)
    expect(c.container.textContent).toBe('')
  })
})
