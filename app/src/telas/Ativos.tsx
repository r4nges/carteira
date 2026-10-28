import { BannerDefasado, temCotacaoDeBolsa } from '../componentes/BannerDefasado'
import { BarraFaixa } from '../componentes/BarraFaixa'
import { EstadoVazio } from '../componentes/EstadoVazio'
import { Selo } from '../componentes/Selo'
import type { DadosCarteira } from '../lib/banco'
import { classeSinal, comMais, dataBR, decimal, moeda, pct, quandoBR, quantidade } from '../lib/formato'
import { diferencaAlvoReais, estaDefasado, patrimonio, pesoPct, valorPosicao } from '../lib/metricas'
import type { Ativo, Cotacao, Rota, Tesouro } from '../lib/tipos'
import { useAgora } from '../lib/useAgora'
import { CONSULTA_DESKTOP, useMidia } from '../lib/useMidia'

interface Props {
  dados: DadosCarteira
  /** Instante de referência para "defasado"; por padrão, o relógio, renovado a cada minuto. */
  agora?: Date
  aoNavegar?: (rota: Rota) => void
}

interface Linha {
  ativo: Ativo
  rendaFixa: boolean
  valor: number
  estimado: boolean
  peso: number
  alvo: number | null
  diferenca: number | null
  cotacao: Cotacao | undefined
  tesouro: Tesouro | undefined
  defasado: boolean
}

interface Subtotal {
  qtd: number
  valor: number
  peso: number
}

function finito(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function positivo(n: number | null | undefined): n is number {
  return finito(n) && n > 0
}

function ehRendaFixa(a: Ativo): boolean {
  return a.tipo === 'Tesouro Direto' || a.tipo === 'Renda fixa'
}

function montar(dados: DadosCarteira, agora: Date) {
  const { ativos, cotacoes, tesouros } = dados
  const resumo = patrimonio(ativos, cotacoes, tesouros)

  const linhas: Linha[] = ativos.map((ativo) => {
    const cotacao = cotacoes[ativo.codigo]
    const tesouro = tesouros[ativo.codigo]
    const { valor, estimado } = valorPosicao(ativo, cotacao, tesouro)
    return {
      ativo,
      rendaFixa: ehRendaFixa(ativo),
      valor,
      estimado,
      peso: pesoPct(valor, resumo.total),
      alvo: finito(ativo.alvo_pct) ? ativo.alvo_pct : null,
      diferenca: diferencaAlvoReais(ativo, valor, resumo.total),
      cotacao,
      tesouro,
      // Sem cotação nenhuma não há o que marcar como velho: o aviso é "cotação indisponível".
      defasado: temCotacaoDeBolsa(ativo) && cotacao !== undefined && estaDefasado(cotacao, agora),
    }
  })

  // Bolsa primeiro, depois renda fixa; do maior valor para o menor.
  linhas.sort((a, b) => Number(a.rendaFixa) - Number(b.rendaFixa) || b.valor - a.valor)

  const fixa = linhas.filter((l) => l.rendaFixa)
  const somaFixa = Math.round(fixa.reduce((s, l) => s + l.valor, 0) * 100) / 100
  const subtotal: Subtotal | null =
    fixa.length > 0 ? { qtd: fixa.length, valor: somaFixa, peso: pesoPct(somaFixa, resumo.total) } : null

  return { linhas, subtotal, total: resumo.total, estimados: resumo.semCotacao.length }
}

/** Posição na faixa de 52 semanas: a do coletor, ou calculada pelo preço e pelos extremos. */
function posicaoFaixa(c: Cotacao | undefined): number | null {
  if (!c) return null
  if (finito(c.posicao_faixa52_pct)) return c.posicao_faixa52_pct
  if (positivo(c.preco) && finito(c.faixa52_min) && finito(c.faixa52_max) && c.faixa52_max > c.faixa52_min) {
    return ((c.preco - c.faixa52_min) / (c.faixa52_max - c.faixa52_min)) * 100
  }
  return null
}

/** Variação do dia: % do coletor (ou calculada pelo fechamento anterior) e R$ por unidade. */
function variacao(c: Cotacao | undefined): { pct: number | null; reais: number | null } {
  if (!c) return { pct: null, reais: null }
  const preco = c.preco
  const anterior = c.prev_close
  if (positivo(preco) && positivo(anterior)) {
    return {
      pct: finito(c.variacao_dia_pct) ? c.variacao_dia_pct : (preco / anterior - 1) * 100,
      reais: preco - anterior,
    }
  }
  return { pct: finito(c.variacao_dia_pct) ? c.variacao_dia_pct : null, reais: null }
}

function unidade(tipo: Ativo['tipo'], q: number): string {
  const plural = q > 1
  switch (tipo) {
    case 'FII':
    case 'ETF':
      return plural ? 'cotas' : 'cota'
    case 'Ação':
      return plural ? 'ações' : 'ação'
    case 'BDR':
      return plural ? 'BDRs' : 'BDR'
    case 'Tesouro Direto':
      return plural ? 'títulos' : 'título'
    default:
      return ''
  }
}

function detalhe(l: Linha): string {
  const { ativo: a, cotacao: c } = l
  const partes: string[] = []
  if (finito(a.quantidade)) partes.push(`${quantidade(a.quantidade)} ${unidade(a.tipo, a.quantidade)}`.trim())
  if (l.rendaFixa) {
    if (a.produto) partes.push(a.produto)
    if (a.vencimento && dataBR(a.vencimento) !== '—') partes.push(`vence em ${dataBR(a.vencimento)}`)
  } else if (a.tipo === 'FII') {
    if (finito(c?.pvp)) partes.push(`P/VP ${decimal(c.pvp)}`)
  } else if (a.tipo === 'Ação' || a.tipo === 'BDR') {
    if (finito(c?.pl)) partes.push(`P/L ${decimal(c.pl)}`)
  }
  return partes.join(' · ')
}

function Valor({ l }: { l: Linha }) {
  if (l.estimado && l.valor === 0) return <span class="neutro">valor indisponível</span>
  return (
    <span class="ativo__valor">
      <span class="num ativo__dinheiro">{moeda(l.valor)}</span>
      {l.estimado && <span class="etiqueta etiqueta--aviso">valor estimado</span>}
    </span>
  )
}

/** `alvo` undefined = subtotal, que não tem alvo nem "sem alvo"; null = ativo sem alvo definido. */
function Peso({ peso, alvo, diferenca }: { peso: number; alvo?: number | null; diferenca?: number | null }) {
  const preenchido = Math.min(100, Math.max(0, peso))
  return (
    <span class="peso">
      <span class="peso__texto">
        <span class="num">{pct(peso)}</span>
        {typeof alvo === 'number' && (
          <span class="neutro num">{` · alvo ${pct(alvo, Number.isInteger(alvo) ? 0 : 1)}`}</span>
        )}
        {alvo === null && <span class="neutro">{' · sem alvo'}</span>}
      </span>
      <span class="peso__barra" aria-hidden="true">
        <span class="peso__preenchimento" style={{ width: `${preenchido}%` }} />
        {typeof alvo === 'number' && <span class="peso__alvo" style={{ left: `${Math.min(100, Math.max(0, alvo))}%` }} />}
      </span>
      {typeof diferenca === 'number' && (
        <span class="peso__diferenca num">
          {diferenca > 0 ? `faltam ${moeda(diferenca)}` : diferenca < 0 ? `acima ${moeda(-diferenca)}` : 'no alvo'}
        </span>
      )}
    </span>
  )
}

/**
 * Marca do coletor quando brapi e Yahoo discordam além do limite (`verificacao.divergente`).
 * `pct` é o módulo da diferença, ou null se o coletor não trouxe um número válido.
 */
function divergencia(c: Cotacao | undefined): { pct: number | null } | null {
  const v = c?.verificacao
  if (typeof v !== 'object' || v === null || Array.isArray(v) || v.divergente !== true) return null
  const x = v.brapi_x_yahoo_pct
  return { pct: typeof x === 'number' && Number.isFinite(x) ? Math.abs(x) : null }
}

function Preco({ l, agora }: { l: Linha; agora: Date }) {
  const { ativo: a, cotacao: c, tesouro: t } = l

  if (a.tipo === 'Tesouro Direto') {
    const base = t?.data_base && dataBR(t.data_base) !== '—' ? dataBR(t.data_base) : null
    return (
      <span class="preco">
        <span class="num">{finito(t?.taxa_venda) ? `taxa de venda ${pct(t.taxa_venda, 2)}` : 'taxa indisponível'}</span>
        {base && <span class="preco__quando neutro">{`base ${base}`}</span>}
      </span>
    )
  }

  if (a.tipo === 'Renda fixa') {
    const data = a.atualizado_em && dataBR(a.atualizado_em) !== '—' ? ` de ${dataBR(a.atualizado_em)}` : ''
    return (
      <span class="preco">
        <span class="neutro">{`valor da planilha${data}`}</span>
      </span>
    )
  }

  const v = variacao(c)
  const marca = quandoBR(c?.as_of ?? c?.atualizado_em, agora)
  const fonte = c?.preco_fonte ? ` · ${c.preco_fonte}` : ''
  const dv = divergencia(c)
  return (
    <span class="preco">
      {positivo(c?.preco) ? (
        <span class="num preco__valor">{moeda(c.preco)}</span>
      ) : (
        <span class="neutro">{c ? 'preço indisponível' : 'cotação indisponível'}</span>
      )}
      {v.pct !== null && (
        <span class={`preco__variacao num ${classeSinal(v.pct)}`} title="variação do dia (por unidade)">
          {comMais(v.pct, pct(v.pct, 2))}
          {v.reais !== null && ` · ${comMais(v.reais, moeda(v.reais))}`}
        </span>
      )}
      {c?.erro && <span class="preco__erro baixa">{c.erro}</span>}
      {l.defasado && <span class="etiqueta etiqueta--aviso">defasado</span>}
      {dv && (
        <span class="etiqueta etiqueta--aviso" title="brapi e Yahoo trazem preços diferentes para este ativo">
          {dv.pct === null ? 'fontes divergem' : `fontes divergem ${pct(dv.pct)}`}
        </span>
      )}
      {marca && <span class="preco__quando neutro">{`${marca}${fonte}`}</span>}
    </span>
  )
}

function Faixa({ l }: { l: Linha }) {
  if (l.rendaFixa) return null
  const c = l.cotacao
  return <BarraFaixa posicao={posicaoFaixa(c)} min={c?.faixa52_min} max={c?.faixa52_max} />
}

function SeloDaLinha({ l, dados }: { l: Linha; dados: DadosCarteira }) {
  if (l.rendaFixa) return null
  return <Selo posicao={posicaoFaixa(l.cotacao)} limites={dados.config.limites} />
}

function Resumo({ total, qtd, estimados }: { total: number; qtd: number; estimados: number }) {
  return (
    <p class="ativos__resumo">
      Patrimônio <strong class="num">{moeda(total)}</strong>
      {` · ${qtd} ${qtd === 1 ? 'ativo' : 'ativos'}`}
      {estimados > 0 &&
        `. ${estimados} ${estimados === 1 ? 'valor é estimado' : 'valores são estimados'} pela planilha, não pela cotação.`}
    </p>
  )
}

interface PropsLista {
  dados: DadosCarteira
  linhas: Linha[]
  subtotal: Subtotal | null
  agora: Date
}

function rotuloPosicoes(n: number): string {
  return `${n} ${n === 1 ? 'posição' : 'posições'}`
}

function Tabela({ dados, linhas, subtotal, agora }: PropsLista) {
  return (
    <div class="tabela-rolagem">
      <table class="tabela ativos__tabela">
        <caption class="so-leitor">Ativos da carteira</caption>
        <thead>
          <tr>
            <th scope="col">Ativo</th>
            <th scope="col">Valor</th>
            <th scope="col">% da carteira · alvo</th>
            <th scope="col">Preço · dia</th>
            <th scope="col">Faixa de 52 semanas</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.ativo.codigo}>
              <th scope="row" class="ativos__ativo">
                <span class="tabela__codigo">{l.ativo.codigo}</span>
                <span class="ativos__detalhe">{detalhe(l)}</span>
              </th>
              <td>
                <Valor l={l} />
              </td>
              <td>
                <Peso peso={l.peso} alvo={l.alvo} diferenca={l.diferenca} />
              </td>
              <td>
                <Preco l={l} agora={agora} />
              </td>
              <td>
                <Faixa l={l} />
              </td>
              <td>
                <SeloDaLinha l={l} dados={dados} />
              </td>
            </tr>
          ))}
          {subtotal && (
            <tr class="ativos__subtotal">
              <th scope="row" class="ativos__ativo">
                <span class="tabela__codigo">Renda fixa</span>
                <span class="ativos__detalhe">{rotuloPosicoes(subtotal.qtd)}</span>
              </th>
              <td>
                <span class="num ativo__dinheiro">{moeda(subtotal.valor)}</span>
              </td>
              <td>
                <Peso peso={subtotal.peso} />
              </td>
              <td colSpan={3} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Cartoes({ dados, linhas, subtotal, agora }: PropsLista) {
  return (
    <ul class="cartoes">
      {linhas.map((l) => (
        <li key={l.ativo.codigo} class="cartao">
          <div class="cartao__topo">
            <span class="tabela__codigo">{l.ativo.codigo}</span>
            <SeloDaLinha l={l} dados={dados} />
          </div>
          <span class="ativos__detalhe">{detalhe(l)}</span>
          <Valor l={l} />
          <Peso peso={l.peso} alvo={l.alvo} diferenca={l.diferenca} />
          <Preco l={l} agora={agora} />
          <Faixa l={l} />
        </li>
      ))}
      {subtotal && (
        <li class="cartao cartao--subtotal">
          <div class="cartao__topo">
            <span class="tabela__codigo">Renda fixa</span>
          </div>
          <span class="ativos__detalhe">{rotuloPosicoes(subtotal.qtd)}</span>
          <span class="num ativo__dinheiro">{moeda(subtotal.valor)}</span>
          <Peso peso={subtotal.peso} />
        </li>
      )}
    </ul>
  )
}

/** Uma linha por ativo (tabela no desktop, cartões no celular), com o aviso de cotação velha no alto. */
export function Ativos({ dados, agora: fixo, aoNavegar }: Props) {
  const desktop = useMidia(CONSULTA_DESKTOP)
  const agora = useAgora(fixo)

  if (dados.ativos.length === 0) return <EstadoVazio aoNavegar={aoNavegar} />

  const { linhas, subtotal, total, estimados } = montar(dados, agora)
  return (
    <section class="ativos">
      <BannerDefasado ativos={dados.ativos} cotacoes={dados.cotacoes} agora={agora} />
      <Resumo total={total} qtd={dados.ativos.length} estimados={estimados} />
      {desktop ? (
        <Tabela dados={dados} linhas={linhas} subtotal={subtotal} agora={agora} />
      ) : (
        <Cartoes dados={dados} linhas={linhas} subtotal={subtotal} agora={agora} />
      )}
    </section>
  )
}
