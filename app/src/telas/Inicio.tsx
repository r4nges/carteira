import type { JSX } from 'preact'
import { useMemo, useRef, useState } from 'preact/hooks'
import { BannerDefasado, temCotacaoDeBolsa } from '../componentes/BannerDefasado'
import { EstadoVazio } from '../componentes/EstadoVazio'
import { Evolucao } from '../componentes/Evolucao'
import { Noticias } from '../componentes/Noticias'
import { montarFatias, Rosca } from '../componentes/Rosca'
import type { DadosCarteira } from '../lib/banco'
import { classeSinal, comMais, dataBR, hojeSP, moeda, pct, quandoBR } from '../lib/formato'
import { estaDefasado, movimentosDoDia, patrimonio } from '../lib/metricas'
import type { Cotacao, Rota } from '../lib/tipos'
import { useAgora } from '../lib/useAgora'

interface Props {
  dados: DadosCarteira
  /** Instante de referência para "defasado" e "atualizado"; por padrão, o relógio, renovado a cada minuto. */
  agora?: Date
  aoNavegar?: (rota: Rota) => void
  /** Pede uma nova leitura dos dados; sem ele, o botão "Atualizar" não aparece. */
  aoAtualizar?: () => void
  /** Há uma leitura em andamento (desabilita o botão). */
  atualizando?: boolean
  /** A última atualização falhou; os dados na tela podem estar velhos. */
  falhaAtualizacao?: boolean
}

type Aba = 'carteira' | 'noticias'

const ABAS: { aba: Aba; rotulo: string }[] = [
  { aba: 'carteira', rotulo: 'Carteira' },
  { aba: 'noticias', rotulo: 'Notícias' },
]

const CHAVE_ABA = 'carteira.inicio.aba'

/** Última aba aberta. O armazenamento pode faltar ou falhar: nesse caso, Carteira. */
function lerAba(): Aba {
  try {
    const v = window.localStorage.getItem(CHAVE_ABA)
    return ABAS.some((a) => a.aba === v) ? (v as Aba) : 'carteira'
  } catch {
    return 'carteira'
  }
}

function gravarAba(aba: Aba): void {
  try {
    window.localStorage.setItem(CHAVE_ABA, aba)
  } catch {
    // sem armazenamento: só não lembra
  }
}

interface Atualizacao {
  /** Instante da cotação de bolsa mais recente com data válida. */
  iso: string
  fonte: string | null
}

function maisRecente(dados: DadosCarteira): Atualizacao | null {
  let melhor: { t: number; c: Cotacao; iso: string } | null = null
  for (const a of dados.ativos) {
    if (!temCotacaoDeBolsa(a)) continue
    const c = dados.cotacoes[a.codigo]
    const iso = c?.as_of ?? c?.atualizado_em
    if (!c || !iso) continue
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) continue
    if (melhor === null || t > melhor.t) melhor = { t, c, iso }
  }
  return melhor ? { iso: melhor.iso, fonte: melhor.c.preco_fonte } : null
}

/**
 * "dd/mm" do pregão a que a variação se refere quando não é o de hoje (fim de semana, feriado,
 * antes da abertura); null quando a cotação mais recente é de hoje ou não há data.
 */
function diaDoPregao(dados: DadosCarteira, agora: Date): string | null {
  const recente = maisRecente(dados)
  if (!recente) return null
  const quando = new Date(recente.iso)
  if (hojeSP(quando) === hojeSP(agora)) return null
  return dataBR(recente.iso).slice(0, 5)
}

function Atualizado({ dados, agora }: { dados: DadosCarteira; agora: Date }) {
  const recente = maisRecente(dados)
  const bolsa = dados.ativos.some(temCotacaoDeBolsa)
  let texto: string
  if (recente) {
    texto = `atualizado ${quandoBR(recente.iso, agora)}${recente.fonte ? ` · ${recente.fonte}` : ''}`
  } else if (bolsa) {
    texto = 'Sem horário de atualização disponível.'
  } else {
    texto = 'Valores de renda fixa vêm da planilha importada.'
  }
  return (
    <span class="neutro inicio__atualizado" data-testid="atualizado">
      {texto}
    </span>
  )
}

interface PropsPainel {
  dados: DadosCarteira
  agora: Date
  aoNavegar?: (rota: Rota) => void
  aoAtualizar?: () => void
  atualizando?: boolean
  falhaAtualizacao?: boolean
}

function PainelCarteira({ dados, agora, aoNavegar, aoAtualizar, atualizando, falhaAtualizacao }: PropsPainel) {
  const { ativos, cotacoes, tesouros, snapshots } = dados
  const resumo = useMemo(() => patrimonio(ativos, cotacoes, tesouros), [ativos, cotacoes, tesouros])
  const fatias = useMemo(() => montarFatias({ ativos, cotacoes, tesouros }), [ativos, cotacoes, tesouros])
  const movimentos = useMemo(() => movimentosDoDia(ativos, cotacoes), [ativos, cotacoes])

  if (ativos.length === 0) return <EstadoVazio aoNavegar={aoNavegar} />

  const deBolsa = ativos.filter(temCotacaoDeBolsa)
  const foraDoDia = deBolsa.length - movimentos.length
  const estimados = resumo.semCotacao.length
  const pregao = diaDoPregao(dados, agora)
  const quando = pregao ? `no pregão de ${pregao}` : 'hoje'
  const tituloMovimentos = pregao ? `Movimentações do pregão de ${pregao}` : 'Movimentações do dia'

  return (
    <div class="inicio__carteira">
      <BannerDefasado ativos={ativos} cotacoes={cotacoes} agora={agora} />

      <section class="inicio__resumo" aria-label="Patrimônio">
        <p class="inicio__rotulo">Patrimônio</p>
        <p class="inicio__patrimonio num" data-testid="patrimonio">
          {resumo.total > 0 ? moeda(resumo.total) : 'valor indisponível'}
        </p>
        <p class="inicio__linha-dia">
          {movimentos.length > 0 ? (
            <span class={`num ${classeSinal(resumo.variacaoReais)}`} data-testid="variacao-dia">
              {`${comMais(resumo.variacaoReais, moeda(resumo.variacaoReais))} (${comMais(resumo.variacaoPct, pct(resumo.variacaoPct))}) ${quando}`}
            </span>
          ) : (
            <span class="neutro" data-testid="variacao-dia">
              variação do dia indisponível
            </span>
          )}
          <Atualizado dados={dados} agora={agora} />
          {aoAtualizar && (
            <button
              type="button"
              class="botao botao--texto"
              onClick={() => {
                if (!atualizando) aoAtualizar()
              }}
              disabled={atualizando}
              aria-busy={atualizando ? 'true' : undefined}
            >
              Atualizar
            </button>
          )}
          {falhaAtualizacao && (
            <span class="neutro inicio__atualizado" role="status">
              Não foi possível atualizar agora.
            </span>
          )}
        </p>
        {movimentos.length > 0 && foraDoDia > 0 && (
          <p class="neutro inicio__nota">{`Variação calculada com ${movimentos.length} de ${deBolsa.length} ativos de bolsa.`}</p>
        )}
        {estimados > 0 && (
          <p class="neutro inicio__nota">
            {`${estimados} ${estimados === 1 ? 'valor é estimado' : 'valores são estimados'} pela planilha, não pela cotação.`}
          </p>
        )}
      </section>

      <div class="inicio__graficos">
        <section class="cartao-grafico" aria-labelledby="titulo-composicao">
          <h2 class="cartao-grafico__titulo" id="titulo-composicao">
            Composição
          </h2>
          {fatias.length > 0 ? (
            <Rosca fatias={fatias} />
          ) : (
            <p class="neutro">Sem valores para mostrar a composição.</p>
          )}
        </section>
        <section class="cartao-grafico" aria-labelledby="titulo-evolucao">
          <h2 class="cartao-grafico__titulo" id="titulo-evolucao">
            Evolução
          </h2>
          <Evolucao snapshots={snapshots} agora={agora} />
        </section>
      </div>

      <section class="cartao-grafico" aria-labelledby="titulo-movimentos">
        <h2 class="cartao-grafico__titulo" id="titulo-movimentos">
          {tituloMovimentos}
        </h2>
        {movimentos.length > 0 ? (
          <ul class="movimentos" aria-label={`${tituloMovimentos}, do maior impacto em R$ para o menor`}>
            {movimentos.map((m) => (
              <li key={m.codigo} class="movimentos__item">
                <span class="movimentos__codigo">{m.codigo}</span>
                {estaDefasado(cotacoes[m.codigo], agora) && <span class="etiqueta etiqueta--aviso">defasado</span>}
                <span class={`num movimentos__pct ${classeSinal(m.pct)}`}>{comMais(m.pct, pct(m.pct, 2))}</span>
                <span class={`num movimentos__reais ${classeSinal(m.reais)}`}>{comMais(m.reais, moeda(m.reais))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="neutro">Sem cotação com fechamento anterior para calcular a variação do dia.</p>
        )}
        {movimentos.length > 0 && foraDoDia > 0 && (
          <p class="neutro inicio__nota">
            {`${foraDoDia} ${foraDoDia === 1 ? 'ativo sem fechamento anterior ou sem cotação fica' : 'ativos sem fechamento anterior ou sem cotação ficam'} fora da lista.`}
          </p>
        )}
      </section>
    </div>
  )
}

/** Início: abas Carteira e Notícias. */
export function Inicio({ dados, agora: fixo, aoNavegar, aoAtualizar, atualizando, falhaAtualizacao }: Props) {
  const agora = useAgora(fixo)
  const [aba, setAba] = useState<Aba>(lerAba)
  const botoes = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({})

  const escolher = (nova: Aba, foco = false) => {
    setAba(nova)
    gravarAba(nova)
    if (foco) botoes.current[nova]?.focus()
  }

  const aoTeclar = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    const i = ABAS.findIndex((a) => a.aba === aba)
    let destino: number | null = null
    if (e.key === 'ArrowRight') destino = (i + 1) % ABAS.length
    else if (e.key === 'ArrowLeft') destino = (i - 1 + ABAS.length) % ABAS.length
    else if (e.key === 'Home') destino = 0
    else if (e.key === 'End') destino = ABAS.length - 1
    if (destino === null) return
    e.preventDefault()
    escolher(ABAS[destino].aba, true)
  }

  return (
    <section class="inicio">
      <div class="abas" role="tablist" aria-label="Seções do Início">
        {ABAS.map(({ aba: id, rotulo }) => (
          <button
            key={id}
            ref={(el) => {
              botoes.current[id] = el
            }}
            type="button"
            role="tab"
            id={`aba-${id}`}
            class="abas__aba"
            aria-selected={id === aba}
            aria-controls={`painel-${id}`}
            tabIndex={id === aba ? 0 : -1}
            onClick={() => escolher(id)}
            onKeyDown={aoTeclar}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`} class="inicio__painel">
        {aba === 'carteira' ? (
          <PainelCarteira
            dados={dados}
            agora={agora}
            aoNavegar={aoNavegar}
            aoAtualizar={aoAtualizar}
            atualizando={atualizando}
            falhaAtualizacao={falhaAtualizacao}
          />
        ) : (
          <Noticias
            noticias={dados.noticias}
            briefing={dados.indicadores.briefing_mercado}
            aviso={dados.avisoNoticias}
            agora={agora}
          />
        )}
      </div>
    </section>
  )
}
