import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  carregarTudo,
  salvarAlvos,
  salvarImportacao,
  salvarLimites,
  ultimaImportacao,
  type ClienteBanco,
} from './banco'
import type { AtivoImportado } from './importacao'
import type { Ativo } from './tipos'

interface Chamada {
  tabela: string
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete'
  payload?: unknown
  opcoes?: unknown
  filtros: string[]
  ordem?: { coluna: string; asc: boolean }
  limite?: number
}
interface Resposta {
  data: unknown
  error: { message: string } | null
}
type Responder = (c: Chamada) => Resposta | Promise<Resposta>

/** Cliente falso: cada consulta é registrada (na ordem em que é executada) e respondida por `responder`. */
function clienteFalso(responder: Responder = () => ({ data: [], error: null })) {
  const registro: Chamada[] = []
  const cliente = {
    from(tabela: string) {
      const c: Chamada = { tabela, op: 'select', filtros: [] }
      const q = {
        select: () => q,
        insert: (payload: unknown, opcoes?: unknown) => {
          c.op = 'insert'
          c.payload = payload
          c.opcoes = opcoes
          return q
        },
        upsert: (payload: unknown, opcoes?: unknown) => {
          c.op = 'upsert'
          c.payload = payload
          c.opcoes = opcoes
          return q
        },
        update: (payload: unknown) => {
          c.op = 'update'
          c.payload = payload
          return q
        },
        delete: () => {
          c.op = 'delete'
          return q
        },
        eq: (col: string, v: unknown) => {
          c.filtros.push(`eq:${col}=${String(v)}`)
          return q
        },
        in: (col: string, v: unknown[]) => {
          c.filtros.push(`in:${col}=${v.join(',')}`)
          return q
        },
        order: (coluna: string, o?: { ascending?: boolean }) => {
          c.ordem = { coluna, asc: o?.ascending ?? true }
          return q
        },
        limit: (n: number) => {
          c.limite = n
          return q
        },
        then: (ok: (r: Resposta) => unknown, falha?: (e: unknown) => unknown) => {
          registro.push(c)
          return Promise.resolve(responder(c)).then(ok, falha)
        },
      }
      return q
    },
  }
  return { cliente: cliente as unknown as ClienteBanco, registro }
}

const ok = (data: unknown): Resposta => ({ data, error: null })
const falha = (message = 'boom'): Resposta => ({ data: null, error: { message } })

function ativo(p: Partial<Ativo> = {}): Ativo {
  return {
    codigo: 'FIIA11',
    tipo: 'FII',
    produto: 'FUNDO A',
    quantidade: 7,
    valor_atualizado: 86.38,
    preco_fechamento: 12.34,
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
    produto: 'FUNDO A',
    quantidade: 7,
    preco_fechamento: 12.34,
    valor_atualizado: 86.38,
    vencimento: null,
    tesouro_tipo: null,
    ...p,
  }
}

const COLUNAS_ATIVOS = [
  'codigo',
  'tipo',
  'produto',
  'quantidade',
  'valor_atualizado',
  'preco_fechamento',
  'vencimento',
  'tesouro_tipo',
  'alvo_pct',
  'atualizado_em',
]

/** Estado do "banco" para salvarImportacao: leitura de ativos e de alvos_guardados. */
function leituras(atuais: Ativo[], guardados: Record<string, number> = {}): Responder {
  return (c) => {
    if (c.op !== 'select') return ok(null)
    if (c.tabela === 'ativos') return ok(atuais)
    if (c.tabela === 'configuracoes') return ok([{ chave: 'alvos_guardados', valor: guardados }])
    return ok([])
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('carregarTudo', () => {
  const TABELAS = ['ativos', 'cotacoes', 'tesouro', 'snapshots', 'configuracoes']

  it('monta mapas por código e chave, e pede snapshots (mais novos, limitados) e notícias na ordem certa', async () => {
    const { cliente, registro } = clienteFalso((c) => {
      switch (c.tabela) {
        case 'ativos':
          return ok([ativo({ codigo: 'FIIB11' }), ativo({ codigo: 'ACAO4', tipo: 'Ação' })])
        case 'cotacoes':
          return ok([{ codigo: 'FIIB11', preco: 87.65 }])
        case 'tesouro':
          return ok([{ codigo: 'TESOURO_SELIC', pu_venda: 13.13 }])
        case 'snapshots':
          // O banco devolve do mais novo para o mais antigo; o app entrega em ordem crescente.
          return ok([
            { data: '2026-10-03', patrimonio: 44 },
            { data: '2026-10-02', patrimonio: 43 },
            { data: '2026-10-01', patrimonio: 42 },
          ])
        case 'noticias':
          return ok([{ id: 'n1', titulo: 'Titulo' }])
        case 'indicadores':
          return ok([
            { chave: 'macro', valor: { selic: 7 } },
            { chave: 'indices', valor: [1, 2] },
          ])
        default:
          return ok([])
      }
    })
    const r = await carregarTudo(cliente)
    expect(r.ativos.map((a) => a.codigo)).toEqual(['FIIB11', 'ACAO4'])
    expect(r.cotacoes.FIIB11.preco).toBe(87.65)
    expect(r.tesouros.TESOURO_SELIC.pu_venda).toBe(13.13)
    expect(r.snapshots.map((x) => x.data)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(r.noticias[0].id).toBe('n1')
    expect(r.indicadores).toEqual({ macro: { selic: 7 }, indices: [1, 2] })

    const snap = registro.find((c) => c.tabela === 'snapshots')!
    // Mais novos primeiro e com limite: o teto de 1000 linhas do PostgREST nunca corta os dias recentes.
    expect(snap.ordem).toEqual({ coluna: 'data', asc: false })
    expect(snap.limite).toBe(1000)
    const not = registro.find((c) => c.tabela === 'noticias')!
    expect(not.ordem).toEqual({ coluna: 'publicado_em', asc: false })
    expect(not.limite).toBe(200)
    expect(registro.every((c) => c.op === 'select')).toBe(true)
  })

  it('sem configurações salvas usa limites 25/75/90 e alvos guardados vazios', async () => {
    const { cliente } = clienteFalso()
    const r = await carregarTudo(cliente)
    expect(r.config).toEqual({ limites: { barato: 25, meio: 75, teto: 90 }, alvosGuardados: {} })
  })

  it('lê limites e alvos guardados das configurações', async () => {
    const { cliente } = clienteFalso((c) =>
      c.tabela === 'configuracoes'
        ? ok([
            { chave: 'limites_selo', valor: { barato: 10, meio: 50, teto: 80 } },
            { chave: 'alvos_guardados', valor: { ACAO4: 13 } },
          ])
        : ok([]),
    )
    const r = await carregarTudo(cliente)
    expect(r.config.limites).toEqual({ barato: 10, meio: 50, teto: 80 })
    expect(r.config.alvosGuardados).toEqual({ ACAO4: 13 })
  })

  it('limites salvos fora de ordem caem no padrão; alvos não numéricos são ignorados', async () => {
    const { cliente } = clienteFalso((c) =>
      c.tabela === 'configuracoes'
        ? ok([
            { chave: 'limites_selo', valor: { barato: 80, meio: 50, teto: 10 } },
            { chave: 'alvos_guardados', valor: { ACAO4: 'x', FIIA11: 7 } },
          ])
        : ok([]),
    )
    const r = await carregarTudo(cliente)
    expect(r.config.limites).toEqual({ barato: 25, meio: 75, teto: 90 })
    expect(r.config.alvosGuardados).toEqual({ FIIA11: 7 })
  })

  it.each(TABELAS)('erro ao ler %s rejeita com mensagem em pt-BR (nunca devolve vazio)', async (tabela) => {
    const { cliente } = clienteFalso((c) => (c.tabela === tabela ? falha('JWT expired') : ok([])))
    const p = carregarTudo(cliente)
    await expect(p).rejects.toThrow(/Não foi possível carregar/)
    await expect(p).rejects.toThrow(tabela)
    await expect(p).rejects.toThrow(/JWT expired/)
  })

  it.each(['noticias', 'indicadores'])(
    'erro ao ler %s não derruba a carteira: vem vazio e com aviso em pt-BR',
    async (tabela) => {
      const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { cliente } = clienteFalso((c) => {
        if (c.tabela === tabela) return falha('JWT expired')
        if (c.tabela === 'ativos') return ok([ativo({ codigo: 'FIIA11' })])
        if (c.tabela === 'noticias') return ok([{ id: 'n1', titulo: 'Titulo' }])
        if (c.tabela === 'indicadores') return ok([{ chave: 'macro', valor: { selic: 7 } }])
        return ok([])
      })
      const r = await carregarTudo(cliente)
      expect(r.ativos.map((a) => a.codigo)).toEqual(['FIIA11'])
      expect(r.avisoNoticias).toMatch(/Não foi possível carregar as notícias/)
      expect(r.avisoNoticias).toMatch(/JWT expired/)
      if (tabela === 'noticias') expect(r.noticias).toEqual([])
      else expect(r.indicadores).toEqual({})
      // o erro original não se perde: vai para o console, com a causa
      expect(erroLog).toHaveBeenCalledTimes(1)
      expect(erroLog.mock.calls[0][0]).toContain(tabela)
      expect((erroLog.mock.calls[0][1] as Error).message).toMatch(/JWT expired/)
      erroLog.mockRestore()
    },
  )

  it('notícias e indicadores lidos normalmente não trazem aviso', async () => {
    const { cliente } = clienteFalso()
    const r = await carregarTudo(cliente)
    expect(r.avisoNoticias).toBeUndefined()
  })

  it('falha de rede (promessa rejeitada) também rejeita em pt-BR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cliente } = clienteFalso(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(carregarTudo(cliente)).rejects.toThrow(/Não foi possível carregar/)
  })

  it('resposta sem erro mas sem dados também é falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { cliente } = clienteFalso(() => ok(null))
    await expect(carregarTudo(cliente)).rejects.toThrow(/Não foi possível carregar/)
  })
})

describe('salvarImportacao', () => {
  it('grava na ordem: ativos, alvos guardados, remoção dos que saíram, importação', async () => {
    const atuais = [ativo({ codigo: 'FIIA11', alvo_pct: 13 }), ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: 42 })]
    const { cliente, registro } = clienteFalso(leituras(atuais))
    await salvarImportacao(
      [novo({ codigo: 'FIIA11', quantidade: 9 }), novo({ codigo: 'FIIB11' })],
      '2026-10-23',
      'posicao.xlsx',
      cliente,
    )

    const escritas = registro.filter((c) => c.op !== 'select').map((c) => `${c.op}:${c.tabela}`)
    expect(escritas).toEqual([
      'upsert:ativos',
      'upsert:ativos',
      'upsert:configuracoes',
      'delete:ativos',
      'insert:importacoes',
    ])
    // nenhuma escrita antes de todas as leituras
    const primeiraEscrita = registro.findIndex((c) => c.op !== 'select')
    expect(registro.slice(0, primeiraEscrita).every((c) => c.op === 'select')).toBe(true)
  })

  it('linha nova não envia atualizado_em; alterada recebe a hora atual; igual não é reenviada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T15:00:00.000Z'))
    const atuais = [
      ativo({ codigo: 'FIIA11', quantidade: 7 }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 13 }),
    ]
    const { cliente, registro } = clienteFalso(leituras(atuais))
    await salvarImportacao(
      [
        novo({ codigo: 'FIIA11', quantidade: 7 }), // igual
        novo({ codigo: 'ACAO4', tipo: 'Ação', quantidade: 42 }), // alterada
        novo({ codigo: 'FIIB11', quantidade: 13 }), // nova
      ],
      '2026-10-23',
      'posicao.xlsx',
      cliente,
    )
    const ups = registro.filter((c) => c.op === 'upsert' && c.tabela === 'ativos')
    const linhas = ups.flatMap((c) => c.payload as Record<string, unknown>[])
    expect(linhas.map((l) => l.codigo).sort()).toEqual(['ACAO4', 'FIIB11'])
    const nova = linhas.find((l) => l.codigo === 'FIIB11')!
    expect('atualizado_em' in nova).toBe(false)
    const alterada = linhas.find((l) => l.codigo === 'ACAO4')!
    expect(alterada.atualizado_em).toBe('2026-10-26T15:00:00.000Z')
    expect(alterada.quantidade).toBe(42)
    for (const l of linhas) {
      expect(Object.keys(l).every((k) => COLUNAS_ATIVOS.includes(k))).toBe(true)
    }
    for (const c of ups) expect(c.opcoes).toMatchObject({ onConflict: 'codigo', defaultToNull: false })
  })

  it('apaga só os que saíram e guarda o alvo deles antes de apagar', async () => {
    const atuais = [
      ativo({ codigo: 'FIIA11', alvo_pct: 13 }),
      ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: 42 }),
      ativo({ codigo: 'FIIB11', alvo_pct: null }),
    ]
    const { cliente, registro } = clienteFalso(leituras(atuais, { ETFX11: 7 }))
    await salvarImportacao([novo({ codigo: 'FIIA11' })], '2026-10-23', 'posicao.xlsx', cliente)

    const del = registro.find((c) => c.op === 'delete')!
    expect(del.filtros).toEqual(['in:codigo=ACAO4,FIIB11'])
    const guard = registro.find((c) => c.op === 'upsert' && c.tabela === 'configuracoes')!
    expect(guard.payload).toEqual({ chave: 'alvos_guardados', valor: { ETFX11: 7, ACAO4: 42 } })
    expect(registro.indexOf(guard)).toBeLessThan(registro.indexOf(del))
    expect(guard.opcoes).toMatchObject({ onConflict: 'chave' })
  })

  it('sem ativos que saíram não chama delete', async () => {
    const { cliente, registro } = clienteFalso(leituras([ativo()]))
    await salvarImportacao([novo({ quantidade: 13 })], '2026-10-23', 'posicao.xlsx', cliente)
    expect(registro.some((c) => c.op === 'delete')).toBe(false)
  })

  it('registra a importação com data, arquivo e a lista importada', async () => {
    const { cliente, registro } = clienteFalso(leituras([]))
    const lista = [novo({ codigo: 'FIIB11', quantidade: 13 })]
    await salvarImportacao(lista, '2026-10-23', 'posicao-2026-10-23.xlsx', cliente)
    const ins = registro.find((c) => c.op === 'insert' && c.tabela === 'importacoes')!
    expect(ins.payload).toEqual({
      data_posicao: '2026-10-23',
      arquivo: 'posicao-2026-10-23.xlsx',
      ativos: lista,
    })
  })

  it('falha ao gravar ativos interrompe: não grava alvos, não apaga, não registra', async () => {
    const atuais = [ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: 42 })]
    const base = leituras(atuais)
    const { cliente, registro } = clienteFalso((c) => (c.op === 'upsert' && c.tabela === 'ativos' ? falha() : base(c)))
    await expect(salvarImportacao([novo({ codigo: 'FIIB11' })], '2026-10-23', 'a.xlsx', cliente)).rejects.toThrow(
      /Não foi possível salvar/,
    )
    expect(registro.filter((c) => ['delete', 'insert'].includes(c.op))).toHaveLength(0)
    expect(registro.some((c) => c.tabela === 'configuracoes' && c.op === 'upsert')).toBe(false)
  })

  it('falha ao gravar alvos guardados interrompe antes de apagar', async () => {
    const atuais = [ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: 42 })]
    const base = leituras(atuais)
    const { cliente, registro } = clienteFalso((c) =>
      c.op === 'upsert' && c.tabela === 'configuracoes' ? falha() : base(c),
    )
    await expect(salvarImportacao([novo({ codigo: 'FIIB11' })], '2026-10-23', 'a.xlsx', cliente)).rejects.toThrow(
      /Não foi possível salvar/,
    )
    expect(registro.some((c) => c.op === 'delete')).toBe(false)
  })

  it('falha ao ler o estado atual não grava nada', async () => {
    const { cliente, registro } = clienteFalso(() => falha('sem rede'))
    await expect(salvarImportacao([novo()], '2026-10-23', 'a.xlsx', cliente)).rejects.toThrow(/Não foi possível/)
    expect(registro.every((c) => c.op === 'select')).toBe(true)
  })

  it('lista vazia é recusada (apagaria a carteira inteira)', async () => {
    const { cliente, registro } = clienteFalso(leituras([ativo()]))
    await expect(salvarImportacao([], '2026-10-23', 'a.xlsx', cliente)).rejects.toThrow(/nenhum ativo/)
    expect(registro).toHaveLength(0)
  })

  it('código repetido na lista é recusado', async () => {
    const { cliente, registro } = clienteFalso(leituras([]))
    await expect(salvarImportacao([novo(), novo()], '2026-10-23', 'a.xlsx', cliente)).rejects.toThrow(/repetido/)
    expect(registro).toHaveLength(0)
  })

  it.each(['23/10/2026', '2026-13-40', '', '2026-02-30'])('data de posição inválida (%s) é recusada', async (data) => {
    const { cliente, registro } = clienteFalso(leituras([]))
    await expect(salvarImportacao([novo()], data, 'a.xlsx', cliente)).rejects.toThrow(/data/i)
    expect(registro).toHaveLength(0)
  })

  it('guarda o alvo de quem saiu mesmo se o banco já estava sem os ativos novos', async () => {
    const antes = [ativo({ codigo: 'ACAO4', tipo: 'Ação', alvo_pct: 42 })]
    const { cliente, registro } = clienteFalso(leituras(antes))
    await salvarImportacao([novo({ codigo: 'FIIB11' })], '2026-10-23', 'a.xlsx', cliente)
    const guard = registro.find((c) => c.op === 'upsert' && c.tabela === 'configuracoes')!
    expect(guard.payload).toEqual({ chave: 'alvos_guardados', valor: { ACAO4: 42 } })
  })
})

describe('salvarAlvos', () => {
  it('atualiza alvo_pct de cada ativo', async () => {
    const { cliente, registro } = clienteFalso((c) => ok([{ codigo: c.filtros[0].split('=')[1] }]))
    await salvarAlvos({ FIIA11: 13, ACAO4: null, FIIB11: 0 }, cliente)
    const ups = registro.filter((c) => c.op === 'update')
    expect(ups.map((c) => [c.filtros[0], c.payload])).toEqual([
      ['eq:codigo=FIIA11', { alvo_pct: 13 }],
      ['eq:codigo=ACAO4', { alvo_pct: null }],
      ['eq:codigo=FIIB11', { alvo_pct: 0 }],
    ])
  })

  it.each([[101], [-0.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'valor inválido %s é recusado sem gravar',
    async (v) => {
      const { cliente, registro } = clienteFalso()
      await expect(salvarAlvos({ FIIA11: 7, ACAO4: v }, cliente)).rejects.toThrow(/entre 0 e 100/)
      expect(registro).toHaveLength(0)
    },
  )

  it('erro do banco vira exceção em pt-BR', async () => {
    const { cliente } = clienteFalso(() => falha())
    await expect(salvarAlvos({ FIIA11: 7 }, cliente)).rejects.toThrow(/Não foi possível salvar/)
  })

  it('nenhuma linha atualizada (ativo inexistente ou sem permissão) é falha', async () => {
    const { cliente } = clienteFalso(() => ok([]))
    await expect(salvarAlvos({ FIIA11: 7 }, cliente)).rejects.toThrow(/FIIA11/)
  })
})

describe('salvarLimites', () => {
  it('grava limites_selo em configuracoes', async () => {
    const { cliente, registro } = clienteFalso()
    await salvarLimites({ barato: 20, meio: 60, teto: 85 }, cliente)
    expect(registro).toHaveLength(1)
    expect(registro[0]).toMatchObject({
      tabela: 'configuracoes',
      op: 'upsert',
      payload: { chave: 'limites_selo', valor: { barato: 20, meio: 60, teto: 85 } },
      opcoes: { onConflict: 'chave' },
    })
  })

  it.each([
    [{ barato: -1, meio: 50, teto: 80 }],
    [{ barato: 50, meio: 50, teto: 80 }],
    [{ barato: 20, meio: 80, teto: 80 }],
    [{ barato: 20, meio: 60, teto: 101 }],
    [{ barato: Number.NaN, meio: 60, teto: 80 }],
    [{ barato: 80, meio: 60, teto: 40 }],
  ])('limites inválidos %j são recusados sem gravar', async (l) => {
    const { cliente, registro } = clienteFalso()
    await expect(salvarLimites(l, cliente)).rejects.toThrow(/Limites/)
    expect(registro).toHaveLength(0)
  })

  it('aceita os extremos 0 < meio < teto = 100', async () => {
    const { cliente } = clienteFalso()
    await expect(salvarLimites({ barato: 0, meio: 1, teto: 100 }, cliente)).resolves.toBeUndefined()
  })

  it('erro do banco vira exceção em pt-BR', async () => {
    const { cliente } = clienteFalso(() => falha())
    await expect(salvarLimites({ barato: 20, meio: 60, teto: 85 }, cliente)).rejects.toThrow(
      /Não foi possível salvar/,
    )
  })
})

describe('ultimaImportacao', () => {
  it('devolve a importação mais recente', async () => {
    const { cliente, registro } = clienteFalso(() =>
      ok([{ data_posicao: '2026-10-23', importado_em: '2026-10-24T10:00:00Z' }]),
    )
    const r = await ultimaImportacao(cliente)
    expect(r).toEqual({ data_posicao: '2026-10-23', importado_em: '2026-10-24T10:00:00Z' })
    expect(registro[0].ordem).toEqual({ coluna: 'id', asc: false })
    expect(registro[0].limite).toBe(1)
  })

  it('sem importações devolve null', async () => {
    const { cliente } = clienteFalso()
    expect(await ultimaImportacao(cliente)).toBeNull()
  })

  it('erro rejeita', async () => {
    const { cliente } = clienteFalso(() => falha())
    await expect(ultimaImportacao(cliente)).rejects.toThrow(/Não foi possível carregar/)
  })
})

describe('limites do selo salvos com valor ausente', () => {
  it.each([
    [{ barato: null, meio: 50, teto: 80 }],
    [{ meio: 50, teto: 80 }],
    [{ barato: '10', meio: 50, teto: 80 }],
  ])('%j cai no padrão (null/ausente/texto nunca viram 0)', async (valor) => {
    const { cliente } = clienteFalso((c) =>
      c.tabela === 'configuracoes' ? ok([{ chave: 'limites_selo', valor }]) : ok([]),
    )
    const r = await carregarTudo(cliente)
    expect(r.config.limites).toEqual({ barato: 25, meio: 75, teto: 90 })
  })
})
