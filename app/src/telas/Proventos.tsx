import { BannerDefasado, temCotacaoDeBolsa } from '../componentes/BannerDefasado'
import { EstadoVazio } from '../componentes/EstadoVazio'
import type { DadosCarteira } from '../lib/banco'
import { dataBR, moeda, pct, quandoBR } from '../lib/formato'
import { estaDefasado } from '../lib/metricas'
import type { Ativo, Cotacao, Json, Rota } from '../lib/tipos'
import { useAgora } from '../lib/useAgora'
import { CONSULTA_DESKTOP, useMidia } from '../lib/useMidia'

interface Props {
  dados: DadosCarteira
  /** Instante de referência para "defasado"; por padrão, o relógio, renovado a cada minuto. */
  agora?: Date
  aoNavegar?: (rota: Rota) => void
}

const VAZIO = '—'

interface UltimoRendimento {
  valor: number
  /** `dd/mm/aaaa`, ou null quando o coletor não trouxe uma data válida. */
  data: string | null
}

interface Linha {
  codigo: string
  ultimo: UltimoRendimento | null
  dy: number | null
  proventos: number | null
  /** Hora do dado ("às 13:55" ou "27/10/2026 às 17:00"); null sem data utilizável. */
  quando: string | null
  semDados: boolean
  defasado: boolean
}

function finito(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** O coletor grava `{valor, data}`; qualquer outra forma conta como sem dado. */
function lerUltimoRendimento(j: Json | null | undefined): UltimoRendimento | null {
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null
  if (!finito(j.valor)) return null
  const data = typeof j.data === 'string' && dataBR(j.data) !== VAZIO ? dataBR(j.data) : null
  return { valor: j.valor, data }
}

function montar(ativos: Ativo[], cotacoes: Record<string, Cotacao>, agora: Date): Linha[] {
  return ativos
    .filter(temCotacaoDeBolsa)
    .map((a): Linha => {
      const c = cotacoes[a.codigo]
      const ultimo = lerUltimoRendimento(c?.ultimo_rendimento)
      const dy = finito(c?.dy_12m_pct) ? c.dy_12m_pct : null
      const proventos = finito(c?.proventos_12m) ? c.proventos_12m : null
      return {
        codigo: a.codigo,
        ultimo,
        dy,
        proventos,
        quando: quandoBR(c?.as_of ?? c?.atualizado_em, agora),
        semDados: c === undefined,
        // Sem cotação nenhuma não há o que marcar como velho: a linha diz "sem dados".
        defasado: c !== undefined && estaDefasado(c, agora),
      }
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}

function Rendimento({ l }: { l: Linha }) {
  if (!l.ultimo) return <span class="neutro">{VAZIO}</span>
  return (
    <span class="proventos__valor">
      <span class="num ativo__dinheiro">{moeda(l.ultimo.valor)}</span>
      <span class="neutro num">{l.ultimo.data ?? 'data indisponível'}</span>
    </span>
  )
}

function Dy({ l }: { l: Linha }) {
  return l.dy === null ? <span class="neutro">{VAZIO}</span> : <span class="num ativo__dinheiro">{pct(l.dy, 2)}</span>
}

function Proventos12m({ l }: { l: Linha }) {
  return l.proventos === null ? (
    <span class="neutro">{VAZIO}</span>
  ) : (
    <span class="num ativo__dinheiro">{moeda(l.proventos)}</span>
  )
}

/** Hora e fonte do dado, mais as marcas de defasado e de sem dados. */
function Origem({ l }: { l: Linha }) {
  return (
    <span class="proventos__origem">
      {l.semDados && <span class="etiqueta etiqueta--aviso">sem dados</span>}
      {l.defasado && !l.semDados && <span class="etiqueta etiqueta--aviso">defasado</span>}
      {l.quando && <span class="neutro">{`${l.quando} · fonte: coletor`}</span>}
    </span>
  )
}

function Tabela({ linhas }: { linhas: Linha[] }) {
  return (
    <div class="tabela-rolagem">
      <table class="tabela ativos__tabela">
        <caption class="so-leitor">Proventos dos ativos de bolsa</caption>
        <thead>
          <tr>
            <th scope="col">Ativo</th>
            <th scope="col">Último rendimento</th>
            <th scope="col">DY 12 meses</th>
            <th scope="col">Proventos 12 meses (por unidade)</th>
            <th scope="col">Atualização</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.codigo}>
              <th scope="row" class="ativos__ativo">
                <span class="tabela__codigo">{l.codigo}</span>
              </th>
              <td>
                <Rendimento l={l} />
              </td>
              <td>
                <Dy l={l} />
              </td>
              <td>
                <Proventos12m l={l} />
              </td>
              <td>
                <Origem l={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cartoes({ linhas }: { linhas: Linha[] }) {
  return (
    <ul class="cartoes">
      {linhas.map((l) => (
        <li key={l.codigo} class="cartao">
          <div class="cartao__topo">
            <span class="tabela__codigo">{l.codigo}</span>
          </div>
          <dl class="proventos__itens">
            <div>
              <dt>Último rendimento</dt>
              <dd>
                <Rendimento l={l} />
              </dd>
            </div>
            <div>
              <dt>DY 12 meses</dt>
              <dd>
                <Dy l={l} />
              </dd>
            </div>
            <div>
              <dt>Proventos 12 meses (por unidade)</dt>
              <dd>
                <Proventos12m l={l} />
              </dd>
            </div>
          </dl>
          <Origem l={l} />
        </li>
      ))}
    </ul>
  )
}

/** Proventos por ativo de bolsa, como o coletor trouxe (tabela no desktop, cartões no celular). */
export function Proventos({ dados, agora: fixo, aoNavegar }: Props) {
  const desktop = useMidia(CONSULTA_DESKTOP)
  const agora = useAgora(fixo)

  if (dados.ativos.length === 0) return <EstadoVazio aoNavegar={aoNavegar} />

  const linhas = montar(dados.ativos, dados.cotacoes, agora)
  if (linhas.length === 0) return <p class="mensagem">Nenhum ativo de bolsa na carteira.</p>

  return (
    <section class="ativos proventos">
      <BannerDefasado ativos={dados.ativos} cotacoes={dados.cotacoes} agora={agora} />
      <p class="ativos__resumo">
        Valores como o coletor informou, em reais por cota ou ação. DY e proventos não são recalculados aqui.
      </p>
      {desktop ? <Tabela linhas={linhas} /> : <Cartoes linhas={linhas} />}
    </section>
  )
}
