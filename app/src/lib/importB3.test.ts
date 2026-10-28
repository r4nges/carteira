import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { lerPlanilha, tesouroTipo } from './importB3'

type Linha = (string | number | null)[]

function planilha(abas: Record<string, Linha[]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [nome, linhas] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome)
  }
  return wb
}

const CAB_FUNDO: Linha = [
  'Produto',
  'Instituição',
  'Conta',
  'Código de Negociação',
  'Quantidade',
  'Preço de Fechamento',
  'Valor Atualizado',
]

describe('lerPlanilha', () => {
  it('lê aba de fundos, sem dados pessoais, com números em texto e puros', () => {
    const wb = planilha({
      'Fundo de Investimento': [
        CAB_FUNDO,
        ['FIIA11 - FUNDO A', 'CORRETORA X', '12345-6', 'FIIA11', 9, '150,25', '1.201,50'],
        ['FIIB11 - FUNDO B', 'CORRETORA X', '12345-6', 'FIIB11', '2', 10.5, 21],
      ],
    })
    const r = lerPlanilha(wb)
    expect(r.ehMovimentacao).toBe(false)
    expect(r.ativos).toHaveLength(2)
    const a = r.ativos[0]
    expect(a).toEqual({
      codigo: 'FIIA11',
      tipo: 'FII',
      produto: 'FIIA11 - FUNDO A',
      quantidade: 9,
      preco_fechamento: 150.25,
      valor_atualizado: 1201.5,
      vencimento: null,
      tesouro_tipo: null,
    })
    expect(Object.keys(a)).not.toContain('instituicao')
    expect(Object.keys(a)).not.toContain('conta')
    for (const ativo of r.ativos) {
      const valores = Object.values(ativo)
      expect(valores).not.toContain('CORRETORA X')
      expect(valores).not.toContain('12345-6')
    }
    expect(r.ativos[1].quantidade).toBe(2)
    expect(r.ativos[1].preco_fechamento).toBe(10.5)
    expect(r.ativos[1].valor_atualizado).toBe(21)
  })

  it('não vaza CPF/CNPJ de colunas extras', () => {
    const wb = planilha({
      Acoes: [
        ['Produto', 'CPF', 'CNPJ da Empresa', 'Escriturador', 'Código de Negociação', 'Quantidade'],
        ['ACAO4 - ACAO PN', '000.000.000-00', '00.000.000/0001-00', 'ESCRIT', 'ACAO4', 10],
      ],
    })
    const [a] = lerPlanilha(wb).ativos
    expect(a.tipo).toBe('Ação')
    expect(Object.keys(a).sort()).toEqual(
      [
        'codigo',
        'preco_fechamento',
        'produto',
        'quantidade',
        'tesouro_tipo',
        'tipo',
        'valor_atualizado',
        'vencimento',
      ].sort(),
    )
    const texto = JSON.stringify(a)
    expect(texto).not.toContain('000.000.000-00')
    expect(texto).not.toContain('00.000.000/0001-00')
    expect(texto).not.toContain('ESCRIT')
  })

  it('soma o mesmo código em duas corretoras', () => {
    const wb = planilha({
      'Fundo de Investimento': [
        CAB_FUNDO,
        ['FIIA11 - FUNDO A', 'CORRETORA X', '1', 'FIIA11', 6, 100, 600],
        ['FIIA11 - FUNDO A', 'CORRETORA Y', '2', 'FIIA11', 4, 100, 400],
      ],
    })
    const { ativos } = lerPlanilha(wb)
    expect(ativos).toHaveLength(1)
    expect(ativos[0].quantidade).toBe(10)
    expect(ativos[0].valor_atualizado).toBe(1000)
    expect(ativos[0].preco_fechamento).toBe(100)
  })

  it('lê Tesouro Direto com código derivado do nome e vencimento', () => {
    const wb = planilha({
      'Tesouro Direto': [
        ['Produto', 'Instituição', 'Vencimento', 'Quantidade', 'Valor Atualizado'],
        ['Tesouro Prefixado 2032', 'CORRETORA X', '01/01/2032', '0,74', '409,75'],
        ['Tesouro Selic 2029', 'CORRETORA X', '01/03/2029', 0.5, 100],
        ['Tesouro IPCA+ 2035', 'CORRETORA X', '15/05/2035', 1, 50],
      ],
    })
    const { ativos } = lerPlanilha(wb)
    expect(ativos.map((a) => a.codigo)).toEqual([
      'TESOURO_PREFIXADO_2032',
      'TESOURO_SELIC',
      'TESOURO_IPCA_2035',
    ])
    expect(ativos[0]).toMatchObject({
      tipo: 'Tesouro Direto',
      tesouro_tipo: 'Tesouro Prefixado',
      vencimento: '01/01/2032',
      quantidade: 0.74,
      valor_atualizado: 409.75,
      preco_fechamento: null,
    })
    expect(ativos[1].tesouro_tipo).toBe('Tesouro Selic')
    expect(ativos[2].tesouro_tipo).toBe('Tesouro IPCA+')
  })

  it('converte vencimento numérico (serial do Excel) e Date em dd/mm/aaaa', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Produto', 'Vencimento', 'Quantidade'],
      ['Tesouro Prefixado 2032', 47119, 1],
      ['Tesouro Prefixado 2033', new Date(Date.UTC(2033, 0, 1)), 1],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Tesouro Direto')
    const { ativos } = lerPlanilha(wb)
    expect(ativos[0].vencimento).toBe('01/01/2029')
    expect(ativos[1].vencimento).toBe('01/01/2033')
  })

  it('recusa extrato de Movimentação', () => {
    const wb = planilha({
      Movimentação: [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário'],
        ['Credito', '01/01/2026', 'Transferência', 'FIIA11 - FUNDO A', 'CORRETORA X', 6, 10],
      ],
    })
    expect(lerPlanilha(wb)).toEqual({ ativos: [], ehMovimentacao: true })
  })

  it('movimentação junto de posição também não devolve ativos', () => {
    const wb = planilha({
      'Fundo de Investimento': [CAB_FUNDO, ['x', 'y', 'z', 'FIIA11', 1, 1, 1]],
      Movimentação: [['Entrada/Saída', 'Quantidade'], ['Credito', 1]],
    })
    expect(lerPlanilha(wb)).toEqual({ ativos: [], ehMovimentacao: true })
  })

  it('ignora aba sem cabeçalho Quantidade, linha Total e quantidade <= 0', () => {
    const wb = planilha({
      Resumo: [['Produto', 'Valor'], ['FIIA11', 10]],
      Acoes: [
        ['Posição em 01/01/2026'],
        [],
        ['Produto', 'Código de Negociação', 'Quantidade', 'Valor Atualizado'],
        ['ACAO4 - ACAO PN', 'ACAO4', 3, 30],
        ['ZERO3 - ZERADA', 'ZERO3', 0, 0],
        ['NEGA3 - NEGATIVA', 'NEGA3', -2, -2],
        ['VAZI3 - VAZIA', 'VAZI3', '', ''],
        ['Total', '', 3, 30],
      ],
    })
    const { ativos } = lerPlanilha(wb)
    expect(ativos.map((a) => a.codigo)).toEqual(['ACAO4'])
  })

  it('tolera variações de cabeçalho: acento, caixa, espaços e cabeçalho numérico', () => {
    const wb = planilha({
      'Ações': [
        [2026, 'x'],
        ['  PRODUTO ', 'codigo de negociacao', ' QUANTIDADE  ', 'valor atualizado', 123],
        ['ACAO4 - ACAO PN', 'acao4', '1.000', 'R$ 1.234,56', 'lixo'],
      ],
    })
    const { ativos } = lerPlanilha(wb)
    expect(ativos).toHaveLength(1)
    expect(ativos[0]).toMatchObject({
      codigo: 'ACAO4',
      tipo: 'Ação',
      quantidade: 1,
      valor_atualizado: 1234.56,
    })
  })

  it('sem coluna de código, extrai o ticker do produto', () => {
    const wb = planilha({
      ETF: [['Produto', 'Quantidade'], ['ETFA11 - ETF FICTICIO', 5]],
    })
    const { ativos } = lerPlanilha(wb)
    expect(ativos[0]).toMatchObject({ codigo: 'ETFA11', tipo: 'ETF' })
  })

  it('mapeia o tipo pelo nome da aba', () => {
    const cab: Linha = ['Produto', 'Código de Negociação', 'Quantidade']
    const wb = planilha({
      'Acoes': [cab, ['A', 'ACAO4', 1]],
      'Fundo de Investimento': [cab, ['B', 'FIIA11', 1]],
      ETF: [cab, ['C', 'ETFA11', 1]],
      BDR: [cab, ['D', 'BDRA34', 1]],
      'Renda Fixa': [cab, ['E', 'CDBX1', 1]],
      Outra: [cab, ['F', 'OUTR3', 1]],
    })
    const tipos = Object.fromEntries(lerPlanilha(wb).ativos.map((a) => [a.codigo, a.tipo]))
    expect(tipos).toEqual({
      ACAO4: 'Ação',
      FIIA11: 'FII',
      ETFA11: 'ETF',
      BDRA34: 'BDR',
      CDBX1: 'Renda fixa',
      OUTR3: null,
    })
  })

  it('não lança com entradas malformadas', () => {
    const vazio = XLSX.utils.book_new()
    expect(lerPlanilha(vazio)).toEqual({ ativos: [], ehMovimentacao: false })

    const ws = XLSX.utils.aoa_to_sheet([
      ['Produto', 'Código de Negociação', 'Quantidade'],
      [null, null, null],
      [],
      ['ACAO4', 'ACAO4', 'abc'],
      ['ACAO4', 'ACAO4', '1,2,3'],
      ['ACAO4', 'ACAO4', 2],
    ])
    ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 2 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Acoes')
    expect(lerPlanilha(wb).ativos.map((a) => a.quantidade)).toEqual([2])

    const semFolha = { SheetNames: ['Fantasma'], Sheets: {} } as XLSX.WorkBook
    expect(lerPlanilha(semFolha)).toEqual({ ativos: [], ehMovimentacao: false })
    const semNomes = {} as XLSX.WorkBook
    expect(lerPlanilha(semNomes)).toEqual({ ativos: [], ehMovimentacao: false })
  })

  it('aguenta planilha muito grande', () => {
    const linhas: Linha[] = [['Produto', 'Código de Negociação', 'Quantidade', 'Valor Atualizado']]
    for (let i = 0; i < 20000; i++) linhas.push([`P${i}`, `AAAA${i % 50}`, 1, 2])
    const t0 = Date.now()
    const { ativos } = lerPlanilha(planilha({ Acoes: linhas }))
    expect(ativos).toHaveLength(50)
    expect(ativos[0].quantidade).toBe(400)
    expect(ativos[0].valor_atualizado).toBe(800)
    expect(Date.now() - t0).toBeLessThan(10000)
  })
})

describe('tesouroTipo', () => {
  it('remove o ano do final do nome', () => {
    expect(tesouroTipo('Tesouro Prefixado 2032')).toBe('Tesouro Prefixado')
    expect(tesouroTipo('Tesouro IPCA+ 2035')).toBe('Tesouro IPCA+')
    expect(tesouroTipo('Tesouro Selic 2029')).toBe('Tesouro Selic')
    expect(tesouroTipo('Tesouro IPCA+ com Juros Semestrais 2040')).toBe(
      'Tesouro IPCA+ com Juros Semestrais',
    )
  })

  it('devolve null para o que não é Tesouro', () => {
    expect(tesouroTipo('FIIA11 - FUNDO A')).toBeNull()
    expect(tesouroTipo('')).toBeNull()
  })
})
