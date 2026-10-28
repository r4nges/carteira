import { describe, expect, it } from 'vitest'
import { dataBR, decimal, hojeSP, horaBR, moeda, pct, quandoBR, quantidade, comMais, classeSinal } from './formato'

describe('moeda', () => {
  it('formata em pt-BR com espaço comum', () => {
    expect(moeda(1234.56)).toBe('R$ 1.234,56')
    expect(moeda(0)).toBe('R$ 0,00')
    expect(moeda(1234567.891)).toBe('R$ 1.234.567,89')
  })

  it('negativo usa o sinal de menos U+2212', () => {
    expect(moeda(-12.3)).toBe('−R$ 12,30')
  })

  it('negativo que arredonda para zero não mostra sinal', () => {
    expect(moeda(-0.001)).toBe('R$ 0,00')
  })

  it('não finito: travessão', () => {
    expect(moeda(Number.NaN)).toBe('—')
    expect(moeda(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('não contém espaço não separável', () => {
    expect(moeda(1000)).not.toMatch(/[  ]/)
  })
})

describe('pct', () => {
  it('uma casa por padrão', () => {
    expect(pct(1.23)).toBe('1,2%')
    expect(pct(0)).toBe('0,0%')
  })

  it('negativo usa U+2212', () => {
    expect(pct(-1.23)).toBe('−1,2%')
  })

  it('número de casas configurável', () => {
    expect(pct(12.3456, 2)).toBe('12,35%')
    expect(pct(12.3, 0)).toBe('12%')
  })

  it('negativo que arredonda para zero não mostra sinal', () => {
    expect(pct(-0.04)).toBe('0,0%')
  })

  it('não finito: travessão', () => {
    expect(pct(Number.NaN)).toBe('—')
  })
})

describe('dataBR e horaBR', () => {
  it('usam America/Sao_Paulo, não o fuso da máquina', () => {
    // 2026-10-26T02:30:00Z = 25/10/2026 23:30 em São Paulo (UTC-3).
    expect(dataBR('2026-10-26T02:30:00Z')).toBe('25/10/2026')
    expect(horaBR('2026-10-26T02:30:00Z')).toBe('23:30')
  })

  it('meia-noite em São Paulo vira 00:00, nunca 24:00', () => {
    expect(horaBR('2026-10-26T03:00:00Z')).toBe('00:00')
  })

  it('data pura (sem hora) não sofre deslocamento de fuso', () => {
    expect(dataBR('2026-10-26')).toBe('26/10/2026')
  })

  it('entrada inválida: travessão', () => {
    expect(dataBR('lixo')).toBe('—')
    expect(horaBR('lixo')).toBe('—')
  })
})

describe('hojeSP', () => {
  it('usa o dia de São Paulo, não o UTC', () => {
    // 01:30 UTC de 27/10 ainda é 26/10 em São Paulo (UTC-3).
    expect(hojeSP(new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26')
    expect(hojeSP(new Date('2026-10-27T03:00:00Z'))).toBe('2026-10-27')
  })
})

describe('decimal e quantidade', () => {
  it('decimal formata em pt-BR com casas fixas', () => {
    expect(decimal(1234.5)).toBe('1.234,50')
    expect(decimal(0.912, 2)).toBe('0,91')
    expect(decimal(7, 0)).toBe('7')
  })

  it('decimal: não finito vira travessão e -0 não mostra sinal', () => {
    expect(decimal(Number.NaN)).toBe('—')
    expect(decimal(Number.POSITIVE_INFINITY)).toBe('—')
    expect(decimal(-0.001)).toBe('0,00')
  })

  it('quantidade mostra só as casas necessárias', () => {
    expect(quantidade(40)).toBe('40')
    expect(quantidade(1234.5)).toBe('1.234,5')
    expect(quantidade(0.12345678)).toBe('0,12345678')
    expect(quantidade(Number.NaN)).toBe('—')
  })
})

describe('quandoBR', () => {
  const agora = new Date('2026-10-28T17:00:00Z')

  it('hoje: só "às HH:MM"', () => {
    expect(quandoBR('2026-10-28T16:55:00Z', agora)).toBe('às 13:55')
  })

  it('outro dia: data e hora', () => {
    expect(quandoBR('2026-10-23T20:30:00Z', agora)).toBe('23/10/2026 às 17:30')
  })

  it('ausente ou inválido: null', () => {
    expect(quandoBR(null, agora)).toBeNull()
    expect(quandoBR(undefined, agora)).toBeNull()
    expect(quandoBR('lixo', agora)).toBeNull()
  })
})

describe('comMais e classeSinal', () => {
  it('"+" só em positivo que não arredonda para zero', () => {
    expect(comMais(1.5, '1,5%')).toBe('+1,5%')
    expect(comMais(0.001, 'R$ 0,00')).toBe('R$ 0,00')
    expect(comMais(-1, '−R$ 1,00')).toBe('−R$ 1,00')
  })

  it('classe pelo valor arredondado a 2 casas', () => {
    expect(classeSinal(0.5)).toBe('alta')
    expect(classeSinal(-0.5)).toBe('baixa')
    expect(classeSinal(0)).toBe('neutro')
    expect(classeSinal(0.001)).toBe('neutro')
  })
})
