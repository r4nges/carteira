import { describe, expect, it } from 'vitest'
import { aplicarImportacao, type AtivoImportado } from './importacao'
import type { Ativo } from './tipos'

function atual(p: Partial<Ativo> = {}): Ativo {
  return {
    codigo: 'FIIA11',
    tipo: 'FII',
    produto: 'FIIA11 - FUNDO A',
    quantidade: 5,
    valor_atualizado: 500,
    preco_fechamento: 100,
    vencimento: null,
    tesouro_tipo: null,
    alvo_pct: null,
    atualizado_em: '2026-01-01T00:00:00Z',
    ...p,
  }
}

function novo(p: Partial<AtivoImportado> = {}): AtivoImportado {
  return {
    codigo: 'FIIA11',
    tipo: 'FII',
    produto: 'FIIA11 - FUNDO A',
    quantidade: 9,
    preco_fechamento: 110,
    valor_atualizado: 990,
    vencimento: null,
    tesouro_tipo: null,
    ...p,
  }
}

describe('aplicarImportacao', () => {
  it('ativo existente mantém alvo_pct e recebe os dados novos', () => {
    const r = aplicarImportacao([atual({ alvo_pct: 12.5 })], [novo()], {})
    expect(r.ativos).toHaveLength(1)
    expect(r.ativos[0]).toMatchObject({
      codigo: 'FIIA11',
      alvo_pct: 12.5,
      quantidade: 9,
      valor_atualizado: 990,
      preco_fechamento: 110,
    })
    expect(r.guardados).toEqual({})
  })

  it('ativo novo sem alvo guardado fica com alvo_pct null', () => {
    const r = aplicarImportacao([], [novo({ codigo: 'FIIB11' })], { OUTRO3: 4 })
    expect(r.ativos).toHaveLength(1)
    expect(r.ativos[0].alvo_pct).toBeNull()
    expect(r.ativos[0].atualizado_em).toBeNull()
    expect(r.guardados).toEqual({ OUTRO3: 4 })
  })

  it('ativo novo com alvo guardado recupera o alvo e sai de guardados', () => {
    const r = aplicarImportacao([], [novo({ codigo: 'FIIB11' })], { FIIB11: 7, OUTRO3: 4 })
    expect(r.ativos[0].alvo_pct).toBe(7)
    expect(r.guardados).toEqual({ OUTRO3: 4 })
  })

  it('ativo que sumiu sai de ativos e seu alvo vai para guardados', () => {
    const r = aplicarImportacao(
      [atual({ codigo: 'FIIA11', alvo_pct: 10 }), atual({ codigo: 'ACAO4', alvo_pct: 3 })],
      [novo({ codigo: 'FIIA11' })],
      {},
    )
    expect(r.ativos.map((a) => a.codigo)).toEqual(['FIIA11'])
    expect(r.guardados).toEqual({ ACAO4: 3 })
  })

  it('ativo que sumiu sem alvo não entra em guardados', () => {
    const r = aplicarImportacao([atual({ codigo: 'ACAO4', alvo_pct: null })], [], {})
    expect(r.ativos).toEqual([])
    expect(r.guardados).toEqual({})
  })

  it('não altera as entradas', () => {
    const atuais = [atual({ alvo_pct: 10 }), atual({ codigo: 'ACAO4', alvo_pct: 3 })]
    const novos = [novo(), novo({ codigo: 'FIIB11' })]
    const guardados = { FIIB11: 2 }
    const copia = structuredClone({ atuais, novos, guardados })
    const r = aplicarImportacao(atuais, novos, guardados)
    expect({ atuais, novos, guardados }).toEqual(copia)
    expect(r.guardados).not.toBe(guardados)
    expect(r.guardados).toEqual({ ACAO4: 3 })
  })
})
