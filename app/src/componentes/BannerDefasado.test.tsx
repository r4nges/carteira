import { render } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { ativo, cotacao } from '../teste/fixtures'
import { BannerDefasado } from './BannerDefasado'

// Quarta-feira, 28/10/2026, 14:00 em São Paulo (17:00Z): dentro do pregão.
const AGORA = new Date('2026-10-28T17:00:00Z')

describe('BannerDefasado', () => {
  it('aparece quando o as_of de uma cotação tem mais de 90 min no pregão, com a hora da última atualização', () => {
    const { container, getByRole } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-28T15:20:00Z' }) }}
        agora={AGORA}
      />,
    )
    const banner = getByRole('status')
    expect(banner.textContent).toMatch(/desatualizad|defasad/i)
    expect(container.textContent).toContain('12:20')
    expect(container.textContent).toContain('28/10/2026')
  })

  it('aparece quando o coletor está parado (atualizado_em com mais de 70 min), mesmo com as_of recente', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-28T16:40:00Z', atualizado_em: '2026-10-28T15:49:00Z' }) }}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toMatch(/desatualizad/i)
  })

  it('não aparece com cotação de 30 a 60 min em pregão e coletor em dia', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-28T16:05:00Z', atualizado_em: '2026-10-28T16:40:00Z' }) }}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('não aparece com cotação recente', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-28T16:50:00Z' }) }}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('aparece com cotação marcada como defasada pelo coletor', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-28T16:55:00Z', defasado: true }) }}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toMatch(/desatualizad|defasad/i)
  })

  it('aparece quando a cotação é de mais de 3 dias, mesmo fora do pregão', () => {
    const domingo = new Date('2026-11-01T15:00:00Z')
    const { container } = render(
      <BannerDefasado
        ativos={[ativo()]}
        cotacoes={{ FIIA11: cotacao({ as_of: '2026-10-26T20:00:00Z' }) }}
        agora={domingo}
      />,
    )
    expect(container.textContent).toMatch(/desatualizad|defasad/i)
    expect(container.textContent).toContain('26/10/2026')
  })

  it('ignora Tesouro e renda fixa (não têm cotação de bolsa)', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[
          ativo({ codigo: 'CDBA', tipo: 'Renda fixa' }),
          ativo({ codigo: 'TESA', tipo: 'Tesouro Direto' }),
        ]}
        cotacoes={{}}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('sem nenhuma cotação para um ativo de bolsa: avisa sem inventar hora', () => {
    const { container } = render(<BannerDefasado ativos={[ativo()]} cotacoes={{}} agora={AGORA} />)
    expect(container.textContent).toMatch(/desatualizad|defasad|sem cotação/i)
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity|—/)
  })

  it('uma cotação fresca e outra velha: aparece e mostra a atualização mais recente', () => {
    const { container } = render(
      <BannerDefasado
        ativos={[ativo(), ativo({ codigo: 'FIIB11' })]}
        cotacoes={{
          FIIA11: cotacao({ as_of: '2026-10-28T16:55:00Z' }),
          FIIB11: cotacao({ codigo: 'FIIB11', as_of: '2026-10-28T15:00:00Z' }),
        }}
        agora={AGORA}
      />,
    )
    expect(container.textContent).toMatch(/desatualizad|defasad/i)
    expect(container.textContent).toContain('13:55')
  })
})
