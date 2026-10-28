import { describe, expect, it } from 'vitest'
import {
  coletaDefasada,
  diferencaAlvoReais,
  estaDefasado,
  movimentosDoDia,
  patrimonio,
  pesoPct,
  selo,
  somaAlvos,
  valorPosicao,
} from './metricas'
import type { Ativo, Cotacao, Tesouro } from './tipos'

function ativo(p: Partial<Ativo> = {}): Ativo {
  return {
    codigo: 'FIIA11',
    tipo: 'FII',
    produto: null,
    quantidade: 9,
    valor_atualizado: 900,
    preco_fechamento: null,
    vencimento: null,
    tesouro_tipo: null,
    alvo_pct: null,
    atualizado_em: null,
    ...p,
  }
}

function cotacao(p: Partial<Cotacao> = {}): Cotacao {
  return {
    codigo: 'FIIA11',
    preco: 87.35,
    preco_fonte: null,
    as_of: null,
    defasado: null,
    variacao_dia_pct: null,
    prev_close: null,
    faixa52_min: null,
    faixa52_max: null,
    posicao_faixa52_pct: null,
    pvp: null,
    vpa: null,
    pl: null,
    dy_12m_pct: null,
    ultimo_rendimento: null,
    proventos_12m: null,
    verificacao: null,
    avisos: null,
    erro: null,
    atualizado_em: null,
    ...p,
  }
}

function tesouro(p: Partial<Tesouro> = {}): Tesouro {
  return {
    codigo: 'TESA',
    data_base: null,
    taxa_compra: null,
    taxa_venda: null,
    pu_compra: null,
    pu_venda: 3000,
    atualizado_em: null,
    ...p,
  }
}

describe('valorPosicao', () => {
  it('bolsa: quantidade x preço, arredondado a 2 casas', () => {
    expect(valorPosicao(ativo(), cotacao())).toEqual({ valor: 786.15, estimado: false })
  })

  it('sem cotação: usa o valor da planilha, estimado', () => {
    expect(valorPosicao(ativo())).toEqual({ valor: 900, estimado: true })
  })

  it('preço 0, negativo, nulo ou NaN: usa a planilha, estimado', () => {
    for (const preco of [0, -1, null, Number.NaN]) {
      expect(valorPosicao(ativo(), cotacao({ preco }))).toEqual({ valor: 900, estimado: true })
    }
  })

  it('erro com preço anterior mantido: usa o preço, não é estimado', () => {
    const c = cotacao({ erro: 'timeout', defasado: true })
    expect(valorPosicao(ativo(), c)).toEqual({ valor: 786.15, estimado: false })
  })

  it('sem cotação e sem valor na planilha: 0 estimado, nunca NaN', () => {
    expect(valorPosicao(ativo({ valor_atualizado: null }))).toEqual({ valor: 0, estimado: true })
  })

  it('quantidade nula com preço válido: cai na planilha', () => {
    expect(valorPosicao(ativo({ quantidade: null }), cotacao())).toEqual({
      valor: 900,
      estimado: true,
    })
  })

  it('tesouro: quantidade x pu_venda', () => {
    const a = ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: 0.5 })
    expect(valorPosicao(a, undefined, tesouro())).toEqual({ valor: 1500, estimado: false })
  })

  it('tesouro sem PU válido: planilha, estimado', () => {
    const a = ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: 0.5 })
    expect(valorPosicao(a)).toEqual({ valor: 900, estimado: true })
    expect(valorPosicao(a, undefined, tesouro({ pu_venda: 0 }))).toEqual({
      valor: 900,
      estimado: true,
    })
  })

  it('renda fixa: valor da planilha, não estimado (mesmo com cotação)', () => {
    const a = ativo({ tipo: 'Renda fixa', valor_atualizado: 1234.5 })
    expect(valorPosicao(a, cotacao())).toEqual({ valor: 1234.5, estimado: false })
  })

  it('renda fixa sem valor: 0 estimado', () => {
    const a = ativo({ tipo: 'Renda fixa', valor_atualizado: null })
    expect(valorPosicao(a)).toEqual({ valor: 0, estimado: true })
  })
})

describe('patrimonio', () => {
  it('carteira vazia: tudo zero, sem NaN', () => {
    expect(patrimonio([], {}, {})).toEqual({
      total: 0,
      variacaoReais: 0,
      variacaoPct: 0,
      semCotacao: [],
    })
  })

  it('soma bolsa, tesouro e renda fixa; lista os sem cotação', () => {
    const ativos = [
      ativo({ codigo: 'FIIA11', quantidade: 10 }),
      ativo({ codigo: 'ACAO4', quantidade: 5, valor_atualizado: 400 }),
      ativo({ codigo: 'TESA', tipo: 'Tesouro Direto', quantidade: 1 }),
      ativo({ codigo: 'CDBA', tipo: 'Renda fixa', valor_atualizado: 100.1 }),
    ]
    const cot = { FIIA11: cotacao({ preco: 100.1 }) }
    const r = patrimonio(ativos, cot, { TESA: tesouro({ pu_venda: 2000.2 }) })
    expect(r.total).toBe(3501.3)
    expect(r.semCotacao).toEqual(['ACAO4'])
  })

  it('variação do dia: soma quantidade x (preço - prev_close)', () => {
    const ativos = [
      ativo({ codigo: 'FIIA11', quantidade: 10 }),
      ativo({ codigo: 'FIIB11', quantidade: 5 }),
    ]
    const cot = {
      FIIA11: cotacao({ codigo: 'FIIA11', preco: 102, prev_close: 100 }),
      FIIB11: cotacao({ codigo: 'FIIB11', preco: 48, prev_close: 50 }),
    }
    const r = patrimonio(ativos, cot, {})
    expect(r.variacaoReais).toBe(10)
    // base = 10*100 + 5*50 = 1250
    expect(r.variacaoPct).toBeCloseTo((10 / 1250) * 100, 10)
  })

  it('ativos sem prev_close ficam fora do numerador e da base', () => {
    const ativos = [
      ativo({ codigo: 'FIIA11', quantidade: 10 }),
      ativo({ codigo: 'FIIB11', quantidade: 1000 }),
    ]
    const cot = {
      FIIA11: cotacao({ codigo: 'FIIA11', preco: 110, prev_close: 100 }),
      FIIB11: cotacao({ codigo: 'FIIB11', preco: 50, prev_close: null }),
    }
    const r = patrimonio(ativos, cot, {})
    expect(r.variacaoReais).toBe(100)
    expect(r.variacaoPct).toBeCloseTo(10, 10)
  })

  it('sem nenhum prev_close: variação 0, sem NaN/Infinity', () => {
    const r = patrimonio([ativo()], { FIIA11: cotacao() }, {})
    expect(r.variacaoReais).toBe(0)
    expect(r.variacaoPct).toBe(0)
  })

  it('preço 0 não entra na variação', () => {
    const cot = { FIIA11: cotacao({ preco: 0, prev_close: 100 }) }
    const r = patrimonio([ativo()], cot, {})
    expect(r.variacaoReais).toBe(0)
    expect(r.variacaoPct).toBe(0)
    expect(r.semCotacao).toEqual(['FIIA11'])
  })
})

describe('pesoPct', () => {
  it('total zero ou inválido: 0', () => {
    expect(pesoPct(10, 0)).toBe(0)
    expect(pesoPct(10, Number.NaN)).toBe(0)
    expect(pesoPct(10, -5)).toBe(0)
  })

  it('percentual do total', () => {
    expect(pesoPct(250, 1000)).toBe(25)
  })
})

describe('diferencaAlvoReais', () => {
  it('alvo% do total menos o valor atual', () => {
    expect(diferencaAlvoReais(ativo({ alvo_pct: 30 }), 612.4, 2500)).toBeCloseTo(137.6, 2)
  })

  it('sem alvo: null', () => {
    expect(diferencaAlvoReais(ativo({ alvo_pct: null }), 612.4, 2500)).toBeNull()
  })

  it('acima do alvo: negativo', () => {
    expect(diferencaAlvoReais(ativo({ alvo_pct: 10 }), 500, 1000)).toBe(-400)
  })
})

describe('somaAlvos', () => {
  it('soma os alvos; nulos contam 0', () => {
    const a = [30, 25, 10, 5, null].map((alvo_pct) => ativo({ alvo_pct }))
    expect(somaAlvos(a)).toBe(70)
  })

  it('não acumula erro de ponto flutuante', () => {
    const a = [0.1, 0.2].map((alvo_pct) => ativo({ alvo_pct }))
    expect(somaAlvos(a)).toBe(0.3)
  })
})

describe('selo', () => {
  it('limites padrão 25/75/90', () => {
    expect(selo(25)).toBe('Barato')
    expect(selo(25.1)).toBe('No meio')
    expect(selo(75)).toBe('No meio')
    expect(selo(75.1)).toBe('Perto do teto')
    expect(selo(90)).toBe('Perto do teto')
    expect(selo(90.1)).toBe('Esticado')
    expect(selo(0)).toBe('Barato')
    expect(selo(100)).toBe('Esticado')
  })

  it('null ou NaN: null', () => {
    expect(selo(null)).toBeNull()
    expect(selo(Number.NaN)).toBeNull()
  })

  it('limites customizados', () => {
    const l = { barato: 10, meio: 50, teto: 80 }
    expect(selo(10, l)).toBe('Barato')
    expect(selo(50, l)).toBe('No meio')
    expect(selo(80, l)).toBe('Perto do teto')
    expect(selo(80.5, l)).toBe('Esticado')
  })
})

describe('estaDefasado', () => {
  // Segunda-feira 2026-10-26. 10:00 BRT = 13:00Z; 18:00 BRT = 21:00Z.
  const seg = (hhmmss: string) => new Date(`2026-10-26T${hhmmss}Z`)
  const asOf = (iso: string) => cotacao({ as_of: iso })
  /** Instante `min` minutos antes de `ref`, em ISO. */
  const antes = (ref: Date, min: number) => new Date(ref.getTime() - min * 60_000).toISOString()

  it('sem cotação: defasado', () => {
    expect(estaDefasado(undefined, seg('15:00:00'))).toBe(true)
  })

  it('flag defasado=true: defasado mesmo com dado recente', () => {
    const c = cotacao({ as_of: '2026-10-26T14:59:00Z', defasado: true })
    expect(estaDefasado(c, seg('15:00:00'))).toBe(true)
  })

  it('sem as_of e sem atualizado_em: defasado', () => {
    expect(estaDefasado(cotacao(), seg('15:00:00'))).toBe(true)
  })

  it('data ilegível (as_of ou atualizado_em): defasado', () => {
    expect(estaDefasado(asOf('lixo'), seg('15:00:00'))).toBe(true)
    expect(estaDefasado(cotacao({ atualizado_em: 'lixo' }), seg('15:00:00'))).toBe(true)
    expect(estaDefasado(cotacao({ as_of: '2026-10-26T14:50:00Z', atualizado_em: 'lixo' }), seg('15:00:00'))).toBe(true)
  })

  it('cotação de 15 a 45 min (atraso normal do mercado) não é defasada em pregão', () => {
    const agora = seg('16:00:00')
    for (const min of [15, 30, 45]) {
      const c = cotacao({ as_of: antes(agora, min), atualizado_em: antes(agora, 5) })
      expect(estaDefasado(c, agora)).toBe(false)
    }
  })

  it('em pregão, coletor parado: atualizado_em com 69/70 min não é defasado; com 71 min é', () => {
    const agora = seg('16:00:00')
    const fresca = antes(agora, 30)
    expect(estaDefasado(cotacao({ as_of: fresca, atualizado_em: antes(agora, 69) }), agora)).toBe(false)
    expect(estaDefasado(cotacao({ as_of: fresca, atualizado_em: antes(agora, 70) }), agora)).toBe(false)
    expect(estaDefasado(cotacao({ as_of: fresca, atualizado_em: antes(agora, 71) }), agora)).toBe(true)
  })

  it('em pregão, dado de mercado velho: as_of com 89/90 min não é defasado; com 91 min é', () => {
    const agora = seg('16:00:00')
    const coleta = antes(agora, 5)
    expect(estaDefasado(cotacao({ as_of: antes(agora, 89), atualizado_em: coleta }), agora)).toBe(false)
    expect(estaDefasado(cotacao({ as_of: antes(agora, 90), atualizado_em: coleta }), agora)).toBe(false)
    expect(estaDefasado(cotacao({ as_of: antes(agora, 91), atualizado_em: coleta }), agora)).toBe(true)
  })

  it('ativo ilíquido: as_of do dia anterior é aceito até 10:45 e defasado depois (coletor em dia)', () => {
    const ontem = '2026-10-26T20:55:00Z' // segunda 17:55 BRT
    const terca = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00Z`)
    const c = (agora: Date) => cotacao({ as_of: ontem, atualizado_em: antes(agora, 10) })
    expect(estaDefasado(c(terca('13:44')), terca('13:44'))).toBe(false) // 10:44 BRT
    expect(estaDefasado(c(terca('13:45')), terca('13:45'))).toBe(false) // 10:45 BRT exato
    expect(estaDefasado(c(terca('13:46')), terca('13:46'))).toBe(true) // 10:46 BRT
  })

  it('segunda de manhã com as_of de sexta: aceito até 10:45, defasado depois', () => {
    const sexta = '2026-10-23T20:55:00Z'
    const c = (agora: Date) => cotacao({ as_of: sexta, atualizado_em: antes(agora, 10) })
    expect(estaDefasado(c(seg('13:44:00')), seg('13:44:00'))).toBe(false)
    expect(estaDefasado(c(seg('13:46:00')), seg('13:46:00'))).toBe(true)
  })

  it('as_of de hoje com 80 min às 10:30 vale (a regra de 90 min só vale para o dia de hoje)', () => {
    const agora = seg('13:30:00') // 10:30 BRT
    expect(estaDefasado(cotacao({ as_of: '2026-10-26T12:10:00Z', atualizado_em: antes(agora, 5) }), agora)).toBe(false)
  })

  it('fronteiras da janela de pregão: 10:00 e 18:00 BRT contam como pregão', () => {
    // Só atualizado_em: 90 min de idade em ambos os horários.
    const antigoAbertura = cotacao({ atualizado_em: '2026-10-26T11:30:00Z' })
    expect(estaDefasado(antigoAbertura, seg('12:59:59'))).toBe(false) // 09:59:59 BRT, fora
    expect(estaDefasado(antigoAbertura, seg('13:00:00'))).toBe(true) // 10:00 BRT, dentro
    const antigoFim = cotacao({ atualizado_em: '2026-10-26T19:30:00Z' })
    expect(estaDefasado(antigoFim, seg('21:00:00'))).toBe(true) // 18:00 BRT, dentro
    expect(estaDefasado(antigoFim, seg('21:00:01'))).toBe(false) // 18:00:01 BRT, fora
  })

  it('fora do pregão (noite): dado do mesmo dia não é defasado', () => {
    expect(estaDefasado(asOf('2026-10-26T20:55:00Z'), seg('23:30:00'))).toBe(false)
    const comColeta = cotacao({ as_of: '2026-10-26T20:55:00Z', atualizado_em: '2026-10-26T21:05:00Z' })
    expect(estaDefasado(comColeta, seg('23:30:00'))).toBe(false)
  })

  it('fim de semana: dado de sexta ainda vale; mais de 3 dias não', () => {
    const sabado = new Date('2026-10-24T15:00:00Z')
    expect(estaDefasado(asOf('2026-10-23T20:55:00Z'), sabado)).toBe(false)
    const comColeta = cotacao({ as_of: '2026-10-23T20:55:00Z', atualizado_em: '2026-10-23T21:10:00Z' })
    expect(estaDefasado(comColeta, sabado)).toBe(false)
    const domingoNoite = new Date('2026-10-25T23:00:00Z')
    expect(estaDefasado(asOf('2026-10-21T20:55:00Z'), domingoNoite)).toBe(true)
  })

  it('o dia da semana e a hora são os de São Paulo, não os de UTC', () => {
    // Segunda 01:00Z = domingo 22:00 BRT: fora do pregão, dado de sexta vale.
    const domingoBRT = new Date('2026-10-26T01:00:00Z')
    expect(estaDefasado(asOf('2026-10-23T20:55:00Z'), domingoBRT)).toBe(false)
    // Sexta 13:30Z = 10:30 BRT: dentro do pregão, as_of de hoje com 91 min é defasado.
    const sextaPregao = new Date('2026-10-23T13:30:00Z')
    expect(estaDefasado(asOf('2026-10-23T11:59:00Z'), sextaPregao)).toBe(true)
    // Sábado 15:00Z = 12:00 BRT: sábado nunca é pregão.
    const sabado = new Date('2026-10-24T15:00:00Z')
    expect(estaDefasado(asOf('2026-10-24T12:00:00Z'), sabado)).toBe(false)
  })

  it('mais de 3 dias é defasado mesmo fora do pregão', () => {
    expect(estaDefasado(asOf('2026-10-22T23:00:00Z'), seg('23:30:00'))).toBe(true)
    expect(estaDefasado(asOf('2026-10-23T23:30:00Z'), seg('23:30:00'))).toBe(false)
  })

  it('usa atualizado_em quando as_of falta; as_of tem prioridade para a regra de mercado', () => {
    const so = cotacao({ atualizado_em: '2026-10-26T14:50:00Z' })
    expect(estaDefasado(so, seg('15:00:00'))).toBe(false)
    const soVelho = cotacao({ atualizado_em: '2026-10-26T13:49:00Z' }) // 71 min
    expect(estaDefasado(soVelho, seg('15:00:00'))).toBe(true)
    const ambos = cotacao({ as_of: '2026-10-26T13:00:00Z', atualizado_em: '2026-10-26T14:50:00Z' })
    expect(estaDefasado(ambos, seg('15:00:00'))).toBe(true) // as_of com 120 min
  })

  it('dado no futuro (relógio adiantado): não defasado', () => {
    expect(estaDefasado(asOf('2026-10-26T15:05:00Z'), seg('15:00:00'))).toBe(false)
  })
})

describe('coletaDefasada (briefing e outros carimbos de coleta)', () => {
  const seg = (hhmmss: string) => new Date(`2026-10-26T${hhmmss}Z`)

  it('sem carimbo ou ilegível: defasado', () => {
    expect(coletaDefasada(undefined, seg('15:00:00'))).toBe(true)
    expect(coletaDefasada(null, seg('15:00:00'))).toBe(true)
    expect(coletaDefasada('lixo', seg('15:00:00'))).toBe(true)
  })

  it('em pregão: 69 min não é defasado, 71 min é', () => {
    expect(coletaDefasada('2026-10-26T13:51:00Z', seg('15:00:00'))).toBe(false)
    expect(coletaDefasada('2026-10-26T13:49:00Z', seg('15:00:00'))).toBe(true)
  })

  it('fora do pregão: vale até 3 dias', () => {
    expect(coletaDefasada('2026-10-26T20:55:00Z', seg('23:30:00'))).toBe(false)
    expect(coletaDefasada('2026-10-22T23:00:00Z', seg('23:30:00'))).toBe(true)
  })
})

describe('robustez numérica (T15)', () => {
  it('arredondar nunca devolve -0', () => {
    // 10% de 1000 = 100; 100 - 100,001 = -0,001, que arredonda para zero.
    const r = diferencaAlvoReais(ativo({ alvo_pct: 10 }), 100.001, 1000)
    expect(Object.is(r, -0)).toBe(false)
    expect(r).toBe(0)
    expect(Object.is(somaAlvos([ativo({ alvo_pct: -0.001 })]), -0)).toBe(false)
  })

  it('selo aceita undefined e devolve null', () => {
    expect(selo(undefined)).toBeNull()
    expect(selo(null)).toBeNull()
    expect(selo(Number.NaN)).toBeNull()
  })

  it('diferencaAlvoReais é null quando valor ou total não são finitos', () => {
    const a = ativo({ alvo_pct: 10 })
    expect(diferencaAlvoReais(a, Number.NaN, 1000)).toBeNull()
    expect(diferencaAlvoReais(a, 100, Number.POSITIVE_INFINITY)).toBeNull()
    expect(diferencaAlvoReais(a, Number.NEGATIVE_INFINITY, 1000)).toBeNull()
    expect(diferencaAlvoReais(a, 100, Number.NaN)).toBeNull()
  })
})

describe('movimentosDoDia', () => {
  const ativos = [
    ativo({ codigo: 'FIIA11', quantidade: 7 }),
    ativo({ codigo: 'FIIB11', quantidade: 40 }),
    ativo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 15 }),
  ]
  const cot = {
    FIIA11: cotacao({ codigo: 'FIIA11', preco: 87.35, prev_close: 80 }),
    FIIB11: cotacao({ codigo: 'FIIB11', preco: 11.62, prev_close: 12.4 }),
    ACAO4: cotacao({ codigo: 'ACAO4', preco: 24.18, prev_close: 26 }),
  }

  it('R$ = quantidade x (preço − fechamento anterior); % = preço ÷ fechamento anterior − 1', () => {
    const m = movimentosDoDia(ativos, cot)
    const a = m.find((x) => x.codigo === 'FIIA11')!
    expect(a.reais).toBe(51.45)
    expect(a.pct).toBeCloseTo(9.1875, 4)
  })

  it('ordena pelo valor absoluto em R$, desempatando pelo código', () => {
    expect(movimentosDoDia(ativos, cot).map((x) => x.codigo)).toEqual(['FIIA11', 'FIIB11', 'ACAO4'])
    const iguais = movimentosDoDia(
      [ativo({ codigo: 'FIIB11', quantidade: 1 }), ativo({ codigo: 'FIIA11', quantidade: 1 })],
      {
        FIIA11: cotacao({ codigo: 'FIIA11', preco: 11, prev_close: 10 }),
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 9, prev_close: 10 }),
      },
    )
    expect(iguais.map((x) => x.codigo)).toEqual(['FIIA11', 'FIIB11'])
  })

  it('soma bate com a variação do patrimônio', () => {
    const soma = movimentosDoDia(ativos, cot).reduce((s, x) => s + x.reais, 0)
    expect(Math.round(soma * 100) / 100).toBe(patrimonio(ativos, cot, {}).variacaoReais)
  })

  it('fica de fora: sem cotação, sem fechamento anterior, preço inválido, sem quantidade, renda fixa', () => {
    const m = movimentosDoDia(
      [
        ativo({ codigo: 'FIIA11' }),
        ativo({ codigo: 'FIIB11' }),
        ativo({ codigo: 'ACAO4', tipo: 'Ação' }),
        ativo({ codigo: 'FIIC11', quantidade: null }),
        ativo({ codigo: 'CDBA', tipo: 'Renda fixa' }),
      ],
      {
        FIIB11: cotacao({ codigo: 'FIIB11', preco: 10, prev_close: null }),
        ACAO4: cotacao({ codigo: 'ACAO4', preco: 0, prev_close: 5 }),
        FIIC11: cotacao({ codigo: 'FIIC11', preco: 10, prev_close: 9 }),
        CDBA: cotacao({ codigo: 'CDBA', preco: 10, prev_close: 9 }),
      },
    )
    expect(m).toEqual([])
  })
})
