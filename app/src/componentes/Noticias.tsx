import { useMemo } from 'preact/hooks'
import { dataBR, horaBR, hojeSP } from '../lib/formato'
import { coletaDefasada } from '../lib/metricas'
import type { Noticia } from '../lib/tipos'

interface Props {
  noticias: Noticia[]
  /** Valor de `indicadores.briefing_mercado` (`{ texto, as_of }`); qualquer outra forma esconde o bloco. */
  briefing?: unknown
  /** Aviso de leitura (ex.: notícias não puderam ser carregadas). */
  aviso?: string
  agora: Date
}

const POR_BLOCO = 5
const JANELA_MS = 7 * 24 * 60 * 60 * 1000
const UM_DIA_MS = 24 * 60 * 60 * 1000
/** Relógio do coletor pode adiantar um pouco: até aqui, "agora"; além disso, hora desconhecida. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000

interface Bloco {
  chave: string
  titulo: string
  itens: Noticia[]
}

const TEMAS: { tema: string; chave: string; titulo: string }[] = [
  { tema: 'politica', chave: 'politica', titulo: 'Política e Brasil' },
  { tema: 'economia', chave: 'economia', titulo: 'Economia e juros' },
  { tema: 'mundo', chave: 'mundo', titulo: 'Mundo' },
]

function instante(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** "agora", "há 25 min", "há 3 h", "ontem 14:30" ou "23/10 09:00"; null se a data não vale ou está no futuro. */
export function horaRelativa(iso: string | null | undefined, agora: Date): string | null {
  const t = instante(iso)
  if (t === null || !iso) return null
  const diff = agora.getTime() - t
  if (diff < -TOLERANCIA_FUTURO_MS) return null
  if (diff < 60_000) return 'agora'
  const d = new Date(t)
  if (hojeSP(d) === hojeSP(agora)) {
    const min = Math.floor(diff / 60_000)
    return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`
  }
  if (hojeSP(d) === hojeSP(new Date(agora.getTime() - UM_DIA_MS))) return `ontem ${horaBR(iso)}`
  return `${dataBR(iso).slice(0, 5)} ${horaBR(iso)}`
}

/** Só http(s) vira link; qualquer outra coisa (javascript:, data:, relativo) fica como texto. */
function linkSeguro(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

function listaDeTextos(v: string[] | null | undefined): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
}

function pontuacao(n: Noticia): number {
  const s = Number(n.score)
  return Number.isFinite(s) ? s : 0
}

function porRelevancia(a: Noticia, b: Noticia): number {
  return pontuacao(b) - pontuacao(a) || (instante(b.publicado_em) ?? -Infinity) - (instante(a.publicado_em) ?? -Infinity)
}

function montarBlocos(noticias: Noticia[], agora: Date): Bloco[] {
  const limite = agora.getTime() - JANELA_MS
  const validas = noticias.filter((n) => {
    if (typeof n.titulo !== 'string' || n.titulo.trim() === '') return false
    const t = instante(n.publicado_em)
    return t === null || t >= limite
  })
  validas.sort(porRelevancia)

  const dosAtivos = validas.filter((n) => listaDeTextos(n.ativos).length > 0)
  // Cada notícia aparece uma vez: quem tem ativos fica só em "Seus ativos".
  const dosTemas = validas.filter((n) => listaDeTextos(n.ativos).length === 0)

  const blocos: Bloco[] = [{ chave: 'ativos', titulo: 'Seus ativos', itens: dosAtivos }]
  for (const t of TEMAS) blocos.push({ chave: t.chave, titulo: t.titulo, itens: dosTemas.filter((n) => n.tema === t.tema) })
  return blocos.map((b) => ({ ...b, itens: b.itens.slice(0, POR_BLOCO) })).filter((b) => b.itens.length > 0)
}

function lerBriefing(v: unknown): { texto: string; asOf: string | null } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const { texto, as_of: asOf } = v as { texto?: unknown; as_of?: unknown }
  if (typeof texto !== 'string' || texto.trim() === '') return null
  return { texto: texto.trim(), asOf: typeof asOf === 'string' ? asOf : null }
}

function Hora({ iso, agora }: { iso: string | null; agora: Date }) {
  const texto = horaRelativa(iso, agora)
  if (!texto || !iso) return null
  return (
    <time class="noticia__hora" dateTime={new Date(iso).toISOString()}>
      {texto}
    </time>
  )
}

function Item({ n, agora, comAtivos }: { n: Noticia; agora: Date; comAtivos: boolean }) {
  const href = linkSeguro(n.url)
  const titulo = (n.titulo ?? '').trim()
  const lide = typeof n.lide === 'string' ? n.lide.trim() : ''
  const tambem = listaDeTextos(n.tambem_em)
  const ativos = comAtivos ? listaDeTextos(n.ativos) : []
  const veiculo = typeof n.fonte === 'string' ? n.fonte.trim() : ''
  return (
    <li class="noticia">
      <p class="noticia__titulo">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {titulo}
          </a>
        ) : (
          titulo
        )}
      </p>
      {lide && <p class="noticia__lide">{lide}</p>}
      <p class="noticia__meta neutro">
        {veiculo && <span class="noticia__veiculo">{veiculo}</span>}
        <Hora iso={n.publicado_em} agora={agora} />
        {tambem.length > 0 && <span>{`também em ${tambem.join(', ')}`}</span>}
        {ativos.map((a) => (
          <span key={a} class="etiqueta noticia__ativo">
            {a}
          </span>
        ))}
      </p>
    </li>
  )
}

/** Aba Notícias do Início: título, lide, veículo, hora e link. Nunca o texto completo, sem IA. */
export function Noticias({ noticias, briefing, aviso, agora }: Props) {
  const blocos = useMemo(() => montarBlocos(noticias, agora), [noticias, agora])
  const resumo = lerBriefing(briefing)
  // O coletor já marca no texto os índices velhos ("(dado de dd/mm)", em briefing.py); o app soma a
  // própria marca de idade a partir do as_of do briefing, que é a hora da coleta.
  const horaMercado = resumo ? horaRelativa(resumo.asOf, agora) : null
  const defasado = resumo && horaMercado ? coletaDefasada(resumo.asOf, agora) : false

  return (
    <div class="noticias">
      {aviso && (
        <p class="mensagem mensagem--aviso" role="status">
          {aviso}
        </p>
      )}

      {resumo && (
        <section class="cartao-grafico noticias__bloco" aria-labelledby="titulo-noticias-mercado">
          <h2 class="cartao-grafico__titulo" id="titulo-noticias-mercado">
            Mercado
          </h2>
          <p class="noticias__mercado">{resumo.texto}</p>
          <p class="neutro noticias__fonte">
            {horaMercado ? (
              <>
                {'atualizado '}
                <Hora iso={resumo.asOf} agora={agora} />
                {defasado && <span class="etiqueta etiqueta--aviso">defasado</span>}
              </>
            ) : (
              <span class="etiqueta etiqueta--aviso">sem hora de coleta</span>
            )}
            {' · Fontes: índices do Yahoo e cotações dos seus ativos'}
          </p>
        </section>
      )}

      {blocos.length === 0 && <p class="neutro">Sem notícias coletadas ainda.</p>}

      {blocos.map((b) => (
        <section key={b.chave} class="cartao-grafico noticias__bloco" aria-labelledby={`titulo-noticias-${b.chave}`}>
          <h2 class="cartao-grafico__titulo" id={`titulo-noticias-${b.chave}`}>
            {b.titulo}
          </h2>
          <ul class="noticias__lista">
            {b.itens.map((n) => (
              <Item key={n.id} n={n} agora={agora} comAtivos={b.chave === 'ativos'} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
