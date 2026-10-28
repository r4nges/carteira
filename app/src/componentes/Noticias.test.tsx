import { render, screen, within } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { noticia } from '../teste/fixtures'
import { Noticias } from './Noticias'

// Quarta-feira, 28/10/2026, 14:00 em São Paulo.
const AGORA = new Date('2026-10-28T17:00:00Z')
const HA_25_MIN = '2026-10-28T16:35:00Z'

function bloco(nome: string) {
  return screen.getByRole('region', { name: nome })
}

describe('Noticias', () => {
  it('sem nenhuma notícia mostra "Sem notícias coletadas ainda." e nenhum bloco', () => {
    render(<Noticias noticias={[]} agora={AGORA} />)
    expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })

  it('blocos vazios não aparecem', () => {
    render(
      <Noticias
        noticias={[noticia({ id: 'a', tema: 'politica', titulo: 'Plenário vota projeto', publicado_em: HA_25_MIN })]}
        agora={AGORA}
      />,
    )
    expect(bloco('Política e Brasil')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Seus ativos' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Economia e juros' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Mundo' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Mercado' })).toBeNull()
    expect(screen.queryByText('Sem notícias coletadas ainda.')).toBeNull()
  })

  it('item sem lide mostra só o título (sem parágrafo vazio)', () => {
    render(<Noticias noticias={[noticia({ lide: null, publicado_em: HA_25_MIN })]} agora={AGORA} />)
    const item = within(bloco('Economia e juros')).getAllByRole('listitem')[0]
    expect(within(item).getByRole('link', { name: 'Título de teste' })).toBeTruthy()
    expect(item.querySelector('.noticia__lide')).toBeNull()
  })

  it('lide em branco também é omitido; lide presente aparece como está', () => {
    render(
      <Noticias
        noticias={[
          noticia({ id: 'a', titulo: 'A', lide: '   ', publicado_em: HA_25_MIN }),
          noticia({ id: 'b', titulo: 'B', lide: 'Abertura da matéria.', publicado_em: HA_25_MIN }),
        ]}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Abertura da matéria.')).toBeTruthy()
    expect(document.querySelectorAll('.noticia__lide')).toHaveLength(1)
  })

  it('mostra o veículo e "também em X, Y"', () => {
    render(
      <Noticias
        noticias={[noticia({ fonte: 'Veículo A', tambem_em: ['Veículo B', 'Veículo C'], publicado_em: HA_25_MIN })]}
        agora={AGORA}
      />,
    )
    expect(screen.getByText('Veículo A')).toBeTruthy()
    expect(screen.getByText('também em Veículo B, Veículo C')).toBeTruthy()
  })

  it('sem tambem_em (null ou vazio) não mostra "também em"', () => {
    render(
      <Noticias
        noticias={[
          noticia({ id: 'a', tambem_em: null, publicado_em: HA_25_MIN }),
          noticia({ id: 'b', tambem_em: [], publicado_em: HA_25_MIN }),
        ]}
        agora={AGORA}
      />,
    )
    expect(screen.queryByText(/também em/)).toBeNull()
  })

  it('notícias com mais de 7 dias não aparecem; a de 6 dias aparece', () => {
    render(
      <Noticias
        noticias={[
          noticia({ id: 'velha', titulo: 'Velha', publicado_em: '2026-10-20T16:59:00Z' }),
          noticia({ id: 'nova', titulo: 'Nova', publicado_em: '2026-10-22T17:00:00Z' }),
        ]}
        agora={AGORA}
      />,
    )
    expect(screen.queryByText('Velha')).toBeNull()
    expect(screen.getByText('Nova')).toBeTruthy()
  })

  it('só notícias velhas: mostra o estado vazio', () => {
    render(<Noticias noticias={[noticia({ publicado_em: '2026-10-01T10:00:00Z' })]} agora={AGORA} />)
    expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
  })

  it('até 5 por bloco, por score decrescente; empate: a mais recente primeiro', () => {
    const itens = [
      noticia({ id: '1', titulo: 'T1', score: 0.1, publicado_em: '2026-10-28T10:00:00Z' }),
      noticia({ id: '2', titulo: 'T2', score: 0.9, publicado_em: '2026-10-28T10:00:00Z' }),
      noticia({ id: '3', titulo: 'T3', score: 0.5, publicado_em: '2026-10-28T09:00:00Z' }),
      noticia({ id: '4', titulo: 'T4', score: 0.5, publicado_em: '2026-10-28T11:00:00Z' }),
      noticia({ id: '5', titulo: 'T5', score: 0.7, publicado_em: '2026-10-28T10:00:00Z' }),
      noticia({ id: '6', titulo: 'T6', score: 0.05, publicado_em: '2026-10-28T10:00:00Z' }),
      noticia({ id: '7', titulo: 'T7', score: null, publicado_em: '2026-10-28T10:00:00Z' }),
    ]
    render(<Noticias noticias={itens} agora={AGORA} />)
    const titulos = within(bloco('Economia e juros'))
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(titulos).toEqual(['T2', 'T5', 'T4', 'T3', 'T1'])
  })

  it('item com ativos vai só para "Seus ativos", mostrando os códigos, e não repete no tema', () => {
    render(
      <Noticias
        noticias={[
          noticia({
            id: 'a',
            titulo: 'Sobre o fundo',
            tema: 'economia',
            ativos: ['FIIA11', 'ACAO4'],
            publicado_em: HA_25_MIN,
          }),
          noticia({ id: 'b', titulo: 'Geral', tema: 'economia', ativos: [], publicado_em: HA_25_MIN }),
        ]}
        agora={AGORA}
      />,
    )
    const meus = within(bloco('Seus ativos'))
    expect(meus.getByRole('link', { name: 'Sobre o fundo' })).toBeTruthy()
    expect(meus.getByText('FIIA11')).toBeTruthy()
    expect(meus.getByText('ACAO4')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Sobre o fundo' })).toHaveLength(1)
    const eco = within(bloco('Economia e juros'))
    expect(eco.queryByText('Sobre o fundo')).toBeNull()
    expect(eco.getByText('Geral')).toBeTruthy()
  })

  it('"Seus ativos" vem antes dos temas, na ordem política, economia, mundo', () => {
    render(
      <Noticias
        noticias={[
          noticia({ id: '1', tema: 'mundo', titulo: 'M', publicado_em: HA_25_MIN }),
          noticia({ id: '2', tema: 'economia', titulo: 'E', publicado_em: HA_25_MIN }),
          noticia({ id: '3', tema: 'politica', titulo: 'P', publicado_em: HA_25_MIN }),
          noticia({ id: '4', tema: 'economia', titulo: 'A', ativos: ['FIIB11'], publicado_em: HA_25_MIN }),
        ]}
        agora={AGORA}
      />,
    )
    const nomes = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))
    const titulos = nomes.map((id) => document.getElementById(id!)?.textContent)
    expect(titulos).toEqual(['Seus ativos', 'Política e Brasil', 'Economia e juros', 'Mundo'])
  })

  it('tema desconhecido ou ausente sem ativos não aparece em lugar nenhum', () => {
    render(
      <Noticias
        noticias={[
          noticia({ id: 'a', titulo: 'Sem tema', tema: null, publicado_em: HA_25_MIN }),
          noticia({ id: 'b', titulo: 'Tema novo', tema: 'esportes', publicado_em: HA_25_MIN }),
        ]}
        agora={AGORA}
      />,
    )
    expect(screen.queryByText('Sem tema')).toBeNull()
    expect(screen.queryByText('Tema novo')).toBeNull()
    expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
  })

  it('link abre em nova aba com rel seguro', () => {
    render(<Noticias noticias={[noticia({ publicado_em: HA_25_MIN })]} agora={AGORA} />)
    const a = screen.getByRole('link', { name: 'Título de teste' })
    expect(a.getAttribute('href')).toBe('https://exemplo.com.br/materia')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://exemplo.com/a', '/relativo', 'texto solto', '', null])(
    'URL %s não vira link: o título aparece só como texto',
    (url) => {
      render(<Noticias noticias={[noticia({ url, publicado_em: HA_25_MIN })]} agora={AGORA} />)
      expect(screen.queryByRole('link')).toBeNull()
      expect(screen.getByText('Título de teste')).toBeTruthy()
    },
  )

  it('http (sem s) também é aceito', () => {
    render(<Noticias noticias={[noticia({ url: 'http://exemplo.com.br/a', publicado_em: HA_25_MIN })]} agora={AGORA} />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('http://exemplo.com.br/a')
  })

  it('renderiza o texto como texto, nunca como HTML', () => {
    const { container } = render(
      <Noticias
        noticias={[noticia({ titulo: '<img src=x onerror=alert(1)>', lide: '<b>negrito</b>', publicado_em: HA_25_MIN })]}
        agora={AGORA}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>negrito</b>')).toBeTruthy()
  })

  it('item sem título é descartado', () => {
    render(<Noticias noticias={[noticia({ titulo: '  ', publicado_em: HA_25_MIN })]} agora={AGORA} />)
    expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
  })

  describe('hora relativa', () => {
    function hora(iso: string | null): string | null {
      const { container, unmount } = render(<Noticias noticias={[noticia({ publicado_em: iso })]} agora={AGORA} />)
      const t = container.querySelector('time')
      const texto = t ? t.textContent : null
      unmount()
      return texto
    }

    it.each([
      ['2026-10-28T16:59:30Z', 'agora'],
      ['2026-10-28T16:35:00Z', 'há 25 min'],
      ['2026-10-28T14:00:00Z', 'há 3 h'],
      ['2026-10-28T14:00:01Z', 'há 2 h'],
      ['2026-10-27T17:30:00Z', 'ontem 14:30'],
      ['2026-10-23T12:00:00Z', '23/10 09:00'],
    ])('%s -> %s', (iso, esperado) => {
      expect(hora(iso)).toBe(esperado)
    })

    it('ontem à noite (SP) com menos de 24 h é "ontem", não "há N h"', () => {
      expect(hora('2026-10-28T02:30:00Z')).toBe('ontem 23:30')
    })

    it.each([[null], ['não é data'], ['2026-10-28T20:00:00Z'], ['2099-01-01T00:00:00Z']])(
      'data inválida ou no futuro (%s): sem hora, sem NaN e sem quebrar',
      (iso) => {
        expect(hora(iso)).toBeNull()
        expect(document.body.textContent).not.toMatch(/NaN|Invalid/)
      },
    )
  })

  describe('briefing de mercado', () => {
    const noticias = [noticia({ publicado_em: HA_25_MIN })]

    it('mostra o texto e a hora da coleta', () => {
      render(
        <Noticias
          noticias={noticias}
          briefing={{ texto: 'Ibovespa +0,8% e dólar R$ 5,60 (−0,3%).', as_of: '2026-10-28T16:30:00Z' }}
          agora={AGORA}
        />,
      )
      const b = within(bloco('Mercado'))
      expect(b.getByText('Ibovespa +0,8% e dólar R$ 5,60 (−0,3%).')).toBeTruthy()
      expect(b.getByText('há 30 min')).toBeTruthy()
    })

    it('vem antes dos demais blocos', () => {
      render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: null }} agora={AGORA} />)
      const regioes = screen.getAllByRole('region')
      expect(regioes[0].getAttribute('aria-labelledby')).toBe(bloco('Mercado').getAttribute('aria-labelledby'))
    })

    it.each([[undefined], [null], [{}], [{ texto: '' }], [{ texto: '   ' }], [{ texto: 42 }], ['texto solto'], [[1]]])(
      'escondido quando vazio ou malformado (%j)',
      (briefing) => {
        render(<Noticias noticias={noticias} briefing={briefing} agora={AGORA} />)
        expect(screen.queryByRole('region', { name: 'Mercado' })).toBeNull()
      },
    )

    it.each([[null], [undefined], ['lixo'], ['2099-01-01T00:00:00Z']])(
      'as_of ausente, inválido ou no futuro (%s): mantém o texto e marca "sem hora de coleta"',
      (asOf) => {
        render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: asOf }} agora={AGORA} />)
        const b = within(bloco('Mercado'))
        expect(b.getByText('Texto.')).toBeTruthy()
        expect(b.getByText('sem hora de coleta')).toBeTruthy()
        expect(bloco('Mercado').querySelector('time')).toBeNull()
        expect(b.queryByText('defasado')).toBeNull()
        expect(bloco('Mercado').textContent).not.toMatch(/NaN|Invalid/)
      },
    )

    it('as_of antigo (dias) mostra a hora e a etiqueta "defasado"', () => {
      render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: '2026-10-23T12:00:00Z' }} agora={AGORA} />)
      const b = within(bloco('Mercado'))
      expect(b.getByText('23/10 09:00')).toBeTruthy()
      expect(b.getByText('defasado')).toBeTruthy()
      expect(b.queryByText('sem hora de coleta')).toBeNull()
    })

    it('em pregão, as_of (hora da coleta) com 69 min não é "defasado"; com 71 min é', () => {
      const { unmount } = render(
        <Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: '2026-10-28T15:51:00Z' }} agora={AGORA} />,
      )
      expect(within(bloco('Mercado')).queryByText('defasado')).toBeNull()
      unmount()
      render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: '2026-10-28T15:49:00Z' }} agora={AGORA} />)
      expect(within(bloco('Mercado')).getByText('defasado')).toBeTruthy()
    })

    it('as_of recente: sem etiqueta de defasado nem de falta de hora', () => {
      render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: '2026-10-28T16:30:00Z' }} agora={AGORA} />)
      const b = within(bloco('Mercado'))
      expect(b.queryByText('defasado')).toBeNull()
      expect(b.queryByText('sem hora de coleta')).toBeNull()
    })

    it('nomeia as fontes do briefing', () => {
      render(<Noticias noticias={noticias} briefing={{ texto: 'Texto.', as_of: '2026-10-28T16:30:00Z' }} agora={AGORA} />)
      expect(bloco('Mercado').textContent).toMatch(/Fontes: índices do Yahoo e cotações dos seus ativos/)
    })

    it('aparece mesmo sem notícias; o estado vazio vale só para as notícias', () => {
      render(<Noticias noticias={[]} briefing={{ texto: 'Texto.', as_of: null }} agora={AGORA} />)
      expect(bloco('Mercado')).toBeTruthy()
      expect(screen.getByText('Sem notícias coletadas ainda.')).toBeTruthy()
    })
  })

  it('mostra o aviso de leitura quando informado', () => {
    render(<Noticias noticias={[]} aviso="Não foi possível carregar as notícias (noticias): sem rede" agora={AGORA} />)
    expect(screen.getByRole('status').textContent).toMatch(/sem rede/)
  })
})
