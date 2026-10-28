import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UltimaImportacao } from '../lib/banco'
import type { AtivoImportado } from '../lib/importacao'
import { Importar } from './Importar'

type Linha = (string | number | null)[]

const CAB_POSICAO: Linha = ['Produto', 'Instituição', 'Conta', 'Código de Negociação', 'Quantidade', 'Preço de Fechamento', 'Valor Atualizado']

function arquivo(abas: Record<string, Linha[]>, nome: string): File {
  const wb = XLSX.utils.book_new()
  for (const [aba, linhas] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba)
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], nome, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function posicaoValida(nome = 'posicao-2026-10-23.xlsx'): File {
  return arquivo(
    {
      'Fundo de Investimento': [
        CAB_POSICAO,
        ['FIIA11 - FUNDO A', 'CORRETORA X', '12345-6', 'FIIA11', 7, 12.34, 86.38],
        ['FIIB11 - FUNDO B', 'CORRETORA X', '12345-6', 'FIIB11', 13, 87.65, 1139.45],
      ],
    },
    nome,
  )
}

function movimentacao(): File {
  return arquivo(
    {
      Movimentação: [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário'],
        ['Credito', '10/10/2026', 'Rendimento', 'FIIA11 - FUNDO A', 'CORRETORA X', 7, 1.23],
      ],
    },
    'movimentacao.xlsx',
  )
}

function ultima(data: string | null): () => Promise<UltimaImportacao | null> {
  return vi.fn().mockResolvedValue(data ? { data_posicao: data, importado_em: '2026-10-24T10:00:00Z' } : null)
}

type Salvar = (n: AtivoImportado[], d: string, a: string) => Promise<void>

function montar(opcoes: { salvar?: Salvar; buscarUltima?: () => Promise<UltimaImportacao | null>; aoSalvar?: () => void } = {}) {
  const salvar = opcoes.salvar ?? (vi.fn().mockResolvedValue(undefined) as unknown as Salvar)
  const buscarUltima = opcoes.buscarUltima ?? ultima(null)
  render(<Importar salvar={salvar} buscarUltima={buscarUltima} aoSalvar={opcoes.aoSalvar} />)
  return { salvar: salvar as unknown as ReturnType<typeof vi.fn>, buscarUltima }
}

async function escolher(file: File) {
  fireEvent.change(screen.getByLabelText('Escolher planilha'), { target: { files: [file] } })
}

const botaoSalvar = () => screen.getByRole('button', { name: /^(Salvar carteira|Salvando…)$/ }) as HTMLButtonElement

afterEach(() => {
  vi.useRealTimers()
})

describe('Importar: estado inicial', () => {
  it('mostra instruções de onde baixar, aceita .xlsx/.xls e deixa Salvar desabilitado', async () => {
    montar()
    expect(screen.getByText(/Área do Investidor/)).toBeTruthy()
    expect(screen.getByText(/Minha carteira/)).toBeTruthy()
    const entrada = screen.getByLabelText('Escolher planilha') as HTMLInputElement
    expect(entrada.type).toBe('file')
    expect(entrada.accept).toBe('.xlsx,.xls')
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('mostra a última importação quando existe', async () => {
    montar({ buscarUltima: ultima('2026-10-23') })
    expect(await screen.findByText('Última importação: posição de 23/10/2026')).toBeTruthy()
  })

  it('sem importação anterior não mostra a linha', async () => {
    const { buscarUltima } = montar()
    await waitFor(() => expect(buscarUltima).toHaveBeenCalled())
    expect(screen.queryByText(/Última importação/)).toBeNull()
  })

  it('falha ao buscar a última importação não derruba a tela', async () => {
    montar({ buscarUltima: vi.fn().mockRejectedValue(new Error('sem rede')) })
    await waitFor(() => expect(screen.getByLabelText('Escolher planilha')).toBeTruthy())
    expect(screen.queryByText(/Última importação/)).toBeNull()
  })
})

describe('Importar: leitura do arquivo', () => {
  it('extrato de Movimentação: mensagem de erro e Salvar desabilitado', async () => {
    montar()
    await escolher(movimentacao())
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toBe('Este é o extrato de Movimentação. Use Minha carteira → Baixar em Excel.')
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('planilha válida: prévia com código, quantidade, valor e total, sem dados pessoais', async () => {
    montar()
    await escolher(posicaoValida())
    const tabela = await screen.findByRole('table')
    const linhas = within(tabela).getAllByRole('row')
    expect(within(linhas[0]).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Código',
      'Tipo',
      'Quantidade',
      'Valor',
      'Total',
    ])
    const a = within(linhas[1]).getAllByRole('cell').map((c) => c.textContent)
    expect(a).toEqual(['FIIA11', 'FII', '7', 'R$ 12,34', 'R$ 86,38'])
    const b = within(linhas[2]).getAllByRole('cell').map((c) => c.textContent)
    expect(b).toEqual(['FIIB11', 'FII', '13', 'R$ 87,65', 'R$ 1.139,45'])
    expect(document.body.textContent).not.toContain('CORRETORA X')
    expect(document.body.textContent).not.toContain('12345-6')
    expect(botaoSalvar().disabled).toBe(false)
  })

  it('data da posição vem do nome do arquivo (aaaa-mm-dd) e pode ser editada', async () => {
    const { salvar } = montar()
    await escolher(posicaoValida('Posicao_2026-10-23_extrato.xlsx'))
    const campo = (await screen.findByLabelText('Data da posição')) as HTMLInputElement
    expect(campo.value).toBe('2026-10-23')
    fireEvent.input(campo, { target: { value: '2026-10-22' } })
    fireEvent.click(botaoSalvar())
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
    expect(salvar.mock.calls[0][1]).toBe('2026-10-22')
  })

  it('sem data no nome, usa hoje em São Paulo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T01:30:00Z')) // ainda 26/10 em São Paulo
    montar()
    await escolher(posicaoValida('minha-carteira.xlsx'))
    const campo = (await screen.findByLabelText('Data da posição')) as HTMLInputElement
    expect(campo.value).toBe('2026-10-26')
  })

  it('data apagada bloqueia Salvar', async () => {
    montar()
    await escolher(posicaoValida())
    const campo = await screen.findByLabelText('Data da posição')
    fireEvent.input(campo, { target: { value: '' } })
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('arrastar e soltar também carrega o arquivo', async () => {
    montar()
    const zona = screen.getByTestId('zona-arquivo')
    fireEvent.dragOver(zona, { dataTransfer: { files: [] } })
    fireEvent.drop(zona, { dataTransfer: { files: [posicaoValida()] } })
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  it('arquivo corrompido: erro claro, sem quebrar', async () => {
    montar()
    const lixo = new File([new Uint8Array([0, 255, 3, 4, 200, 17, 0, 0, 9, 9])], 'posicao.xlsx')
    await escolher(lixo)
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(/Não (consegui ler|encontrei)/)
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('arquivo que não é Excel é recusado', async () => {
    montar()
    await escolher(new File(['x'], 'extrato.pdf'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/\.xlsx/)
  })

  it('arquivo grande demais é recusado antes de ler', async () => {
    montar()
    const grande = new File(['x'], 'posicao.xlsx')
    Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 })
    await escolher(grande)
    expect((await screen.findByRole('alert')).textContent).toMatch(/10 MB/)
  })

  it('planilha sem nenhum ativo: mensagem amigável', async () => {
    montar()
    await escolher(arquivo({ 'Fundo de Investimento': [CAB_POSICAO] }, 'posicao.xlsx'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/nenhum ativo/)
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('um erro de leitura some quando se escolhe um arquivo bom', async () => {
    montar()
    await escolher(movimentacao())
    await screen.findByRole('alert')
    await escolher(posicaoValida())
    await screen.findByRole('table')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Importar: tipo não identificado', () => {
  const comDesconhecido = () =>
    arquivo(
      {
        'Fundo de Investimento': [CAB_POSICAO, ['FIIA11 - FUNDO A', 'X', '1', 'FIIA11', 7, 12.34, 86.38]],
        'Aba Estranha': [CAB_POSICAO, ['ACAO4 - EMPRESA', 'X', '1', 'ACAO4', 42, 87.65, 3681.3]],
      },
      'posicao-2026-10-23.xlsx',
    )

  it('sinaliza a linha e bloqueia Salvar até escolher o tipo', async () => {
    const { salvar } = montar()
    await escolher(comDesconhecido())
    await screen.findByRole('table')
    expect(screen.getByText('tipo não identificado')).toBeTruthy()
    expect(botaoSalvar().disabled).toBe(true)

    const seletor = screen.getByLabelText('Tipo de ACAO4') as HTMLSelectElement
    const opcoes = Array.from(seletor.options).map((o) => o.textContent)
    expect(opcoes).toEqual(['Escolher tipo…', 'FII', 'Ação', 'ETF', 'BDR', 'Tesouro Direto', 'Renda fixa'])
    fireEvent.change(seletor, { target: { value: 'Ação' } })

    expect(screen.queryByText('tipo não identificado')).toBeNull()
    expect(botaoSalvar().disabled).toBe(false)
    fireEvent.click(botaoSalvar())
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
    const enviados = salvar.mock.calls[0][0] as AtivoImportado[]
    expect(enviados.find((a) => a.codigo === 'ACAO4')?.tipo).toBe('Ação')
    expect(enviados.find((a) => a.codigo === 'FIIA11')?.tipo).toBe('FII')
  })

  it('remover a linha também libera Salvar, e a linha não é enviada', async () => {
    const { salvar } = montar()
    await escolher(comDesconhecido())
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Remover ACAO4' }))
    expect(screen.queryByText('ACAO4')).toBeNull()
    expect(botaoSalvar().disabled).toBe(false)
    fireEvent.click(botaoSalvar())
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
    expect((salvar.mock.calls[0][0] as AtivoImportado[]).map((a) => a.codigo)).toEqual(['FIIA11'])
  })

  it('remover todas as linhas deixa Salvar desabilitado', async () => {
    montar()
    await escolher(
      arquivo({ 'Aba Estranha': [CAB_POSICAO, ['ACAO4 - EMPRESA', 'X', '1', 'ACAO4', 42, 87.65, 3681.3]] }, 'p.xlsx'),
    )
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Remover ACAO4' }))
    expect(botaoSalvar().disabled).toBe(true)
  })
})

describe('Importar: salvar', () => {
  it('chama salvarImportacao uma vez com ativos, data e nome do arquivo; mostra confirmação', async () => {
    const aoSalvar = vi.fn()
    const { salvar } = montar({ aoSalvar })
    await escolher(posicaoValida('posicao-2026-10-23.xlsx'))
    await screen.findByRole('table')
    fireEvent.click(botaoSalvar())

    expect(await screen.findByText('Carteira salva')).toBeTruthy()
    expect(salvar).toHaveBeenCalledTimes(1)
    const [ativos, data, nome] = salvar.mock.calls[0] as [AtivoImportado[], string, string]
    expect(ativos.map((a) => [a.codigo, a.quantidade])).toEqual([
      ['FIIA11', 7],
      ['FIIB11', 13],
    ])
    expect(data).toBe('2026-10-23')
    expect(nome).toBe('posicao-2026-10-23.xlsx')
    expect(screen.getByText('Última importação: posição de 23/10/2026')).toBeTruthy()
    expect(aoSalvar).toHaveBeenCalledTimes(1)
    // depois de salvar a prévia some: não dá para salvar duas vezes o mesmo arquivo sem querer
    expect(screen.queryByRole('table')).toBeNull()
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('falha de rede: mostra o erro e reabilita o botão para tentar de novo', async () => {
    const salvar = vi
      .fn()
      .mockRejectedValueOnce(new Error('Não foi possível salvar ativos: Failed to fetch.'))
      .mockResolvedValueOnce(undefined)
    montar({ salvar: salvar as unknown as Salvar })
    await escolher(posicaoValida())
    await screen.findByRole('table')
    fireEvent.click(botaoSalvar())

    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(/Não foi possível salvar/)
    expect(screen.queryByText('Carteira salva')).toBeNull()
    expect(botaoSalvar().disabled).toBe(false)
    expect(screen.getByRole('table')).toBeTruthy() // a prévia continua

    fireEvent.click(botaoSalvar())
    expect(await screen.findByText('Carteira salva')).toBeTruthy()
    expect(salvar).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clique duplo não envia duas vezes', async () => {
    let concluir: () => void = () => {}
    const salvar = vi.fn(() => new Promise<void>((r) => (concluir = r)))
    montar({ salvar: salvar as unknown as Salvar })
    await escolher(posicaoValida())
    await screen.findByRole('table')
    const botao = botaoSalvar()
    fireEvent.click(botao)
    fireEvent.click(botao)
    expect(salvar).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(botaoSalvar().disabled).toBe(true))
    concluir()
    expect(await screen.findByText('Carteira salva')).toBeTruthy()
    expect(salvar).toHaveBeenCalledTimes(1)
  })

  it('erro sem mensagem útil ainda mostra texto em pt-BR', async () => {
    const salvar = vi.fn().mockRejectedValue('falhou')
    montar({ salvar: salvar as unknown as Salvar })
    await escolher(posicaoValida())
    await screen.findByRole('table')
    fireEvent.click(botaoSalvar())
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível salvar/)
  })
})
