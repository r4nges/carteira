import { useEffect, useRef, useState } from 'preact/hooks'
import * as XLSX from 'xlsx'
import {
  dataIsoValida,
  salvarImportacao,
  ultimaImportacao,
  type UltimaImportacao,
} from '../lib/banco'
import { dataBR, hojeSP, moeda } from '../lib/formato'
import type { AtivoImportado } from '../lib/importacao'
import { lerPlanilha } from '../lib/importB3'
import type { TipoAtivo } from '../lib/tipos'

export const MENSAGEM_MOVIMENTACAO = 'Este é o extrato de Movimentação. Use Minha carteira → Baixar em Excel.'
const TAMANHO_MAXIMO = 10 * 1024 * 1024
const TIPOS: TipoAtivo[] = ['FII', 'Ação', 'ETF', 'BDR', 'Tesouro Direto', 'Renda fixa']
const DATA_NO_NOME = /(\d{4})-(\d{2})-(\d{2})/
const formatadorQuantidade = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 })

interface Props {
  /** Grava a posição; por padrão usa o Supabase. Injetável para testes. */
  salvar?: (novos: AtivoImportado[], dataPosicao: string, arquivo: string) => Promise<void>
  buscarUltima?: () => Promise<UltimaImportacao | null>
  /** Chamado depois de salvar (para o app recarregar a carteira). */
  aoSalvar?: () => void
}

interface Lido {
  nome: string
  ativos: AtivoImportado[]
}

/** Primeira data `aaaa-mm-dd` do nome do arquivo, se for uma data real. */
function dataDoNome(nome: string): string | null {
  const m = DATA_NO_NOME.exec(nome)
  return m && dataIsoValida(m[0]) ? m[0] : null
}

function lerBytes(arquivo: File): Promise<Uint8Array> {
  if (typeof arquivo.arrayBuffer === 'function') {
    return arquivo.arrayBuffer().then((b) => new Uint8Array(b))
  }
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(new Uint8Array(leitor.result as ArrayBuffer))
    leitor.onerror = () => rejeitar(leitor.error)
    leitor.readAsArrayBuffer(arquivo)
  })
}

function mensagemDeErro(erro: unknown): string {
  const base = 'Não foi possível salvar a carteira.'
  if (erro instanceof Error && erro.message) {
    return erro.message.startsWith('Não foi possível') ? erro.message : `${base} ${erro.message}`
  }
  return `${base} Verifique a conexão e tente de novo.`
}

export function Importar({ salvar = salvarImportacao, buscarUltima = ultimaImportacao, aoSalvar }: Props) {
  const [lido, setLido] = useState<Lido | null>(null)
  const [erroLeitura, setErroLeitura] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)
  const [data, setData] = useState('')
  const [tiposEscolhidos, setTiposEscolhidos] = useState<Record<string, TipoAtivo>>({})
  const [removidos, setRemovidos] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [ultima, setUltima] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)

  const leituraAtual = useRef(0)
  const salvandoRef = useRef(false)

  useEffect(() => {
    let ativo = true
    buscarUltima()
      .then((u) => {
        if (ativo && u?.data_posicao) setUltima(u.data_posicao)
      })
      .catch(() => {
        // Informação secundária: sem ela a tela continua funcionando.
      })
    return () => {
      ativo = false
    }
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return
    const esta = ++leituraAtual.current
    setLido(null)
    setErroLeitura(null)
    setErroSalvar(null)
    setSalvo(false)
    setTiposEscolhidos({})
    setRemovidos(new Set())

    if (!/\.xlsx?$/i.test(arquivo.name)) {
      setErroLeitura('Formato não aceito. Envie a planilha em Excel (.xlsx ou .xls).')
      return
    }
    if (arquivo.size === 0) {
      setErroLeitura('O arquivo está vazio. Baixe a planilha de novo e tente outra vez.')
      return
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      setErroLeitura('O arquivo passa de 10 MB, o limite aceito. Confira se é a planilha de Posição.')
      return
    }

    setLendo(true)
    let resultado: ReturnType<typeof lerPlanilha>
    try {
      const bytes = await lerBytes(arquivo)
      resultado = lerPlanilha(XLSX.read(bytes, { type: 'array' }))
    } catch {
      if (esta !== leituraAtual.current) return
      setLendo(false)
      setErroLeitura('Não consegui ler este arquivo. Ele pode estar corrompido; baixe a planilha de novo e tente outra vez.')
      return
    }
    if (esta !== leituraAtual.current) return
    setLendo(false)

    if (resultado.ehMovimentacao) {
      setErroLeitura(MENSAGEM_MOVIMENTACAO)
      return
    }
    if (resultado.ativos.length === 0) {
      setErroLeitura(
        'Não encontrei nenhum ativo nesta planilha. Confira se é a planilha de Posição (Minha carteira → Baixar em Excel).',
      )
      return
    }
    setData(dataDoNome(arquivo.name) ?? hojeSP())
    setLido({ nome: arquivo.name, ativos: resultado.ativos })
  }

  const linhas = (lido?.ativos ?? [])
    .filter((a) => !removidos.has(a.codigo))
    .map((a): AtivoImportado => ({ ...a, tipo: a.tipo ?? tiposEscolhidos[a.codigo] ?? null }))
  const pendentes = linhas.filter((a) => a.tipo === null).length
  const dataOk = dataIsoValida(data)
  const podeSalvar = lido !== null && linhas.length > 0 && pendentes === 0 && dataOk && !salvando

  async function aoSalvarClicado() {
    if (!lido || !podeSalvar || salvandoRef.current) return
    salvandoRef.current = true
    setSalvando(true)
    setErroSalvar(null)
    try {
      await salvar(linhas, data, lido.nome)
      setUltima(data)
      setSalvo(true)
      setLido(null)
      aoSalvar?.()
    } catch (erro) {
      setErroSalvar(mensagemDeErro(erro))
    } finally {
      salvandoRef.current = false
      setSalvando(false)
    }
  }

  function aoSoltar(e: DragEvent) {
    e.preventDefault()
    setArrastando(false)
    void aoEscolher(e.dataTransfer?.files?.[0])
  }

  function total(a: AtivoImportado): number | null {
    if (a.valor_atualizado != null) return a.valor_atualizado
    return a.preco_fechamento != null ? a.preco_fechamento * a.quantidade : null
  }
  const totais = linhas.map(total)
  const somaCompleta = linhas.length > 0 && totais.every((t) => t !== null)
  const soma = totais.reduce<number>((s, t) => s + (t ?? 0), 0)

  return (
    <div class="importar">
      <section
        class={`solta${arrastando ? ' solta--ativa' : ''}`}
        data-testid="zona-arquivo"
        aria-label="Área para soltar a planilha"
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
      >
        <p class="solta__texto">Arraste a planilha de posição para cá ou</p>
        <input
          id="importar-arquivo"
          class="solta__entrada so-leitor"
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const campo = e.currentTarget as HTMLInputElement
            void aoEscolher(campo.files?.[0])
            campo.value = ''
          }}
        />
        <label for="importar-arquivo" class="botao solta__botao">
          Escolher planilha
        </label>
        <p class="solta__dica">Formatos .xlsx ou .xls, até 10 MB. O arquivo é lido neste aparelho.</p>
      </section>

      {lendo && (
        <p class="mensagem" role="status">
          Lendo a planilha…
        </p>
      )}
      {erroLeitura && (
        <p class="mensagem mensagem--erro" role="alert">
          {erroLeitura}
        </p>
      )}
      {salvo && (
        <p class="mensagem mensagem--ok" role="status">
          Carteira salva
        </p>
      )}
      {ultima && <p class="importar__ultima">Última importação: posição de {dataBR(ultima)}</p>}

      {lido && (
        <section class="previa" aria-labelledby="previa-titulo">
          <h2 id="previa-titulo" class="importar__subtitulo">
            Confira antes de salvar
          </h2>
          <p class="importar__nota">
            {lido.nome}: {linhas.length} {linhas.length === 1 ? 'ativo' : 'ativos'}. Só código, tipo, quantidade e
            valores são guardados.
          </p>

          <div class="campo previa__data">
            <label class="campo__rotulo" for="importar-data">
              Data da posição
            </label>
            <input
              id="importar-data"
              class="campo__entrada"
              type="date"
              value={data}
              onInput={(e) => setData((e.currentTarget as HTMLInputElement).value)}
            />
          </div>

          {linhas.length === 0 ? (
            <p class="mensagem">Todas as linhas foram removidas. Escolha a planilha de novo.</p>
          ) : (
            <div class="tabela-rolagem">
              <table class="tabela">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Tipo</th>
                    <th scope="col" class="tabela__num">
                      Quantidade
                    </th>
                    <th scope="col" class="tabela__num">
                      Valor
                    </th>
                    <th scope="col" class="tabela__num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((a, i) => {
                    const original = lido.ativos.find((x) => x.codigo === a.codigo)!
                    const semTipo = original.tipo === null
                    const t = totais[i]
                    return (
                      <tr key={a.codigo}>
                        <td class="tabela__codigo">{a.codigo}</td>
                        <td>
                          {semTipo ? (
                            <span class="previa__tipo">
                              <select
                                class="campo__entrada"
                                aria-label={`Tipo de ${a.codigo}`}
                                value={a.tipo ?? ''}
                                onChange={(e) => {
                                  const v = (e.currentTarget as HTMLSelectElement).value as TipoAtivo | ''
                                  setTiposEscolhidos((atual) => {
                                    const novo = { ...atual }
                                    if (v) novo[a.codigo] = v
                                    else delete novo[a.codigo]
                                    return novo
                                  })
                                }}
                              >
                                <option value="">Escolher tipo…</option>
                                {TIPOS.map((tipo) => (
                                  <option key={tipo} value={tipo}>
                                    {tipo}
                                  </option>
                                ))}
                              </select>
                              {a.tipo === null && <span class="etiqueta etiqueta--aviso">tipo não identificado</span>}
                              <button
                                type="button"
                                class="botao botao--texto"
                                aria-label={`Remover ${a.codigo}`}
                                onClick={() => setRemovidos((r) => new Set(r).add(a.codigo))}
                              >
                                Remover
                              </button>
                            </span>
                          ) : (
                            a.tipo
                          )}
                        </td>
                        <td class="tabela__num num">{formatadorQuantidade.format(a.quantidade)}</td>
                        <td class="tabela__num num">
                          {a.preco_fechamento != null ? moeda(a.preco_fechamento) : '—'}
                        </td>
                        <td class="tabela__num num">{t != null ? moeda(t) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {somaCompleta && (
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Soma
                      </th>
                      <td class="tabela__num num">{moeda(soma)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {pendentes > 0 && (
            <p class="mensagem mensagem--aviso" role="status">
              {pendentes === 1 ? '1 ativo está' : `${pendentes} ativos estão`} sem tipo. Escolha o tipo ou remova a
              linha para poder salvar.
            </p>
          )}
        </section>
      )}

      {erroSalvar && (
        <p class="mensagem mensagem--erro" role="alert">
          {erroSalvar}
        </p>
      )}

      <div class="importar__acoes">
        <button
          type="button"
          class="botao botao--primario"
          disabled={!podeSalvar}
          aria-busy={salvando ? 'true' : undefined}
          onClick={() => void aoSalvarClicado()}
        >
          {salvando ? 'Salvando…' : 'Salvar carteira'}
        </button>
      </div>

      <section class="instrucoes" aria-labelledby="instrucoes-titulo">
        <h2 id="instrucoes-titulo" class="importar__subtitulo">
          Como baixar a planilha
        </h2>
        <ol class="instrucoes__lista">
          <li>Entre na Área do Investidor da B3, com o seu login.</li>
          <li>Abra Minha carteira.</li>
          <li>Clique em Baixar em Excel e salve o arquivo.</li>
          <li>Volte aqui e envie o arquivo. Não use o extrato de Movimentação.</li>
        </ol>
      </section>
    </div>
  )
}
