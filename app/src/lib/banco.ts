import type { SupabaseClient } from '@supabase/supabase-js'
import { aplicarImportacao, type AtivoImportado } from './importacao'
import { LIMITES_PADRAO, type Limites } from './metricas'
import { obterSupabase } from './supabase'
import type {
  AlvosGuardados,
  Ativo,
  ConfiguracaoLinha,
  Configuracoes,
  Cotacao,
  Json,
  Noticia,
  Snapshot,
  Tesouro,
} from './tipos'

/** O pedaço do cliente que a camada de dados usa (os testes passam um cliente falso). */
export type ClienteBanco = Pick<SupabaseClient, 'from'>

export interface DadosCarteira {
  ativos: Ativo[]
  cotacoes: Record<string, Cotacao>
  tesouros: Record<string, Tesouro>
  snapshots: Snapshot[]
  noticias: Noticia[]
  indicadores: Record<string, unknown>
  /** Preenchido quando notícias ou indicadores não puderam ser lidos (vieram vazios); o resto da carga segue válido. */
  avisoNoticias?: string
  config: Configuracoes
}

export interface UltimaImportacao {
  data_posicao: string | null
  importado_em: string | null
}

/** Quantas notícias recentes o app carrega; a tela filtra o período. */
export const LIMITE_NOTICIAS = 200
/** Teto do PostgREST: lê os mais novos e inverte, para o corte nunca tirar os dias recentes. */
export const LIMITE_SNAPSHOTS = 1000

const CHAVE_LIMITES = 'limites_selo'
const CHAVE_ALVOS = 'alvos_guardados'

interface RespostaBanco {
  data: unknown
  error: { message: string } | null
}

function detalhe(erro: unknown): string {
  if (erro instanceof Error) return erro.message
  if (erro && typeof erro === 'object' && 'message' in erro) return String((erro as { message: unknown }).message)
  return String(erro)
}

/**
 * Espera uma consulta e devolve `data`. Erro do banco, falha de rede ou resposta
 * sem dados viram exceção em pt-BR: um erro nunca pode parecer "tabela vazia"
 * (uma carteira vazia por falha de leitura pareceria o primeiro acesso).
 */
async function ler<T>(consulta: PromiseLike<RespostaBanco>, tabela: string): Promise<T> {
  let r: RespostaBanco
  try {
    r = await consulta
  } catch (erro) {
    throw new Error(`Não foi possível carregar ${tabela}: ${detalhe(erro)}. Verifique a conexão e tente de novo.`)
  }
  if (r.error) {
    throw new Error(`Não foi possível carregar ${tabela}: ${r.error.message}. Verifique a conexão e tente de novo.`)
  }
  if (r.data == null) {
    throw new Error(`Não foi possível carregar ${tabela}: o servidor não devolveu dados. Tente de novo.`)
  }
  return r.data as T
}

/** Espera uma escrita; devolve `data` (pode ser null). */
async function gravar(consulta: PromiseLike<RespostaBanco>, tabela: string): Promise<unknown> {
  let r: RespostaBanco
  try {
    r = await consulta
  } catch (erro) {
    throw new Error(`Não foi possível salvar ${tabela}: ${detalhe(erro)}. Verifique a conexão e tente de novo.`)
  }
  if (r.error) {
    throw new Error(`Não foi possível salvar ${tabela}: ${r.error.message}. Verifique a conexão e tente de novo.`)
  }
  return r.data
}

function porChave<T extends object>(linhas: T[], chave: keyof T): Record<string, T> {
  const saida: Record<string, T> = {}
  for (const l of linhas) saida[String(l[chave])] = l
  return saida
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function limitesValidos(l: Limites): boolean {
  return (
    [l.barato, l.meio, l.teto].every(Number.isFinite) && 0 <= l.barato && l.barato < l.meio && l.meio < l.teto && l.teto <= 100
  )
}

function lerLimites(valor: unknown): Limites {
  if (!ehObjeto(valor)) return { ...LIMITES_PADRAO }
  // Só números de verdade: Number(null) seria 0 e um limite ausente viraria "0".
  const { barato, meio, teto } = valor
  if (typeof barato !== 'number' || typeof meio !== 'number' || typeof teto !== 'number') return { ...LIMITES_PADRAO }
  const l = { barato, meio, teto }
  return limitesValidos(l) ? l : { ...LIMITES_PADRAO }
}

function lerAlvosGuardados(valor: unknown): AlvosGuardados {
  const saida: AlvosGuardados = {}
  if (!ehObjeto(valor)) return saida
  for (const [codigo, pct] of Object.entries(valor)) {
    if (typeof pct === 'number' && Number.isFinite(pct)) saida[codigo] = pct
  }
  return saida
}

function lerConfiguracoes(linhas: ConfiguracaoLinha[]): Configuracoes {
  const mapa = new Map(linhas.map((l) => [l.chave, l.valor]))
  return {
    limites: lerLimites(mapa.get(CHAVE_LIMITES)),
    alvosGuardados: lerAlvosGuardados(mapa.get(CHAVE_ALVOS)),
  }
}

/**
 * Leitura opcional (notícias, briefing): se falhar, devolve `vazio` e o motivo em pt-BR,
 * em vez de derrubar a carteira. O erro nunca some: a tela mostra o aviso.
 */
async function lerOpcional<T>(
  consulta: PromiseLike<RespostaBanco>,
  tabela: string,
  vazio: T,
): Promise<{ valor: T; aviso?: string }> {
  try {
    return { valor: await ler<T>(consulta, tabela) }
  } catch (erro) {
    console.error(`Falha ao ler ${tabela} (a carteira segue sem notícias):`, erro)
    const msg = detalhe(erro)
    const i = msg.indexOf(': ')
    const motivo = i >= 0 ? msg.slice(i + 2) : msg
    return { valor: vazio, aviso: `Não foi possível carregar as notícias (${tabela}): ${motivo}` }
  }
}

/**
 * Lê tudo o que o app mostra. Qualquer consulta essencial que falhe derruba a carga
 * inteira com uma mensagem em pt-BR (nunca devolve um conjunto parcial). As únicas
 * exceções são `noticias` e `indicadores`: se falharem, a carteira carrega e
 * `avisoNoticias` explica por que as notícias estão vazias.
 */
export async function carregarTudo(cliente: ClienteBanco = obterSupabase()): Promise<DadosCarteira> {
  const [ativos, cotacoes, tesouros, snapshots, noticias, indicadores, configuracoes] = await Promise.all([
    ler<Ativo[]>(cliente.from('ativos').select('*'), 'ativos'),
    ler<Cotacao[]>(cliente.from('cotacoes').select('*'), 'cotacoes'),
    ler<Tesouro[]>(cliente.from('tesouro').select('*'), 'tesouro'),
    ler<Snapshot[]>(
      cliente.from('snapshots').select('*').order('data', { ascending: false }).limit(LIMITE_SNAPSHOTS),
      'snapshots',
    ),
    lerOpcional<Noticia[]>(
      cliente.from('noticias').select('*').order('publicado_em', { ascending: false }).limit(LIMITE_NOTICIAS),
      'noticias',
      [],
    ),
    lerOpcional<{ chave: string; valor: unknown }[]>(
      cliente.from('indicadores').select('chave,valor'),
      'indicadores',
      [],
    ),
    ler<ConfiguracaoLinha[]>(cliente.from('configuracoes').select('chave,valor'), 'configuracoes'),
  ])

  const avisoNoticias = [noticias.aviso, indicadores.aviso].filter(Boolean).join(' ')
  return {
    ativos,
    cotacoes: porChave(cotacoes, 'codigo'),
    tesouros: porChave(tesouros, 'codigo'),
    snapshots: [...snapshots].reverse(),
    noticias: noticias.valor,
    indicadores: Object.fromEntries(indicadores.valor.map((i) => [i.chave, i.valor])),
    ...(avisoNoticias ? { avisoNoticias } : {}),
    config: lerConfiguracoes(configuracoes),
  }
}

/** Importação mais recente (para "Última importação: posição de ..."), ou null se nunca houve. */
export async function ultimaImportacao(cliente: ClienteBanco = obterSupabase()): Promise<UltimaImportacao | null> {
  const linhas = await ler<UltimaImportacao[]>(
    cliente.from('importacoes').select('data_posicao,importado_em').order('id', { ascending: false }).limit(1),
    'importacoes',
  )
  return linhas[0] ?? null
}

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/

export function dataIsoValida(iso: string): boolean {
  const m = SO_DATA.exec(iso)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

const CAMPOS_COMPARADOS = [
  'tipo',
  'produto',
  'quantidade',
  'valor_atualizado',
  'preco_fechamento',
  'vencimento',
  'tesouro_tipo',
  'alvo_pct',
] as const satisfies readonly (keyof Ativo)[]

function mudou(antes: Ativo, depois: Ativo): boolean {
  return CAMPOS_COMPARADOS.some((campo) => antes[campo] !== depois[campo])
}

/** Só colunas reais de `ativos`; `atualizado_em` entra apenas quando informado. */
function linhaAtivo(a: Ativo, atualizadoEm?: string): Record<string, Json> {
  const linha: Record<string, Json> = {
    codigo: a.codigo,
    tipo: a.tipo,
    produto: a.produto,
    quantidade: a.quantidade,
    valor_atualizado: a.valor_atualizado,
    preco_fechamento: a.preco_fechamento,
    vencimento: a.vencimento,
    tesouro_tipo: a.tesouro_tipo,
    alvo_pct: a.alvo_pct,
  }
  if (atualizadoEm !== undefined) linha.atualizado_em = atualizadoEm
  return linha
}

function listaImportada(novos: AtivoImportado[]): Json[] {
  return novos.map((n) => ({
    codigo: n.codigo,
    tipo: n.tipo,
    produto: n.produto,
    quantidade: n.quantidade,
    preco_fechamento: n.preco_fechamento,
    valor_atualizado: n.valor_atualizado,
    vencimento: n.vencimento,
    tesouro_tipo: n.tesouro_tipo,
  }))
}

/**
 * Grava a posição importada.
 *
 * O cliente não tem transação, então a ordem das escritas é o que protege os
 * alvos (`alvo_pct`) do usuário. Cada passo deixa o banco consistente e repetir
 * a operação inteira depois de uma falha dá o mesmo resultado final:
 *
 *  1. `ativos`: upsert das linhas novas (sem `atualizado_em`: vale o `now()` do
 *     banco) e das alteradas (com a hora atual). Linhas iguais não são reenviadas.
 *     Nada é apagado ainda; um alvo recuperado de `alvos_guardados` passa a
 *     existir também em `ativos`, sem sair do guardado.
 *  2. `configuracoes.alvos_guardados`: grava os alvos de quem saiu (ainda
 *     presentes em `ativos`, então nada se perde se o próximo passo falhar).
 *  3. `ativos`: apaga quem saiu, só depois de o alvo estar guardado.
 *  4. `importacoes`: registro da importação, por último; só aparece em
 *     "Última importação" se tudo antes deu certo.
 */
export async function salvarImportacao(
  novos: AtivoImportado[],
  dataPosicao: string,
  arquivo: string,
  cliente: ClienteBanco = obterSupabase(),
): Promise<void> {
  if (novos.length === 0) {
    throw new Error('A importação não tem nenhum ativo; nada foi salvo (isso apagaria a carteira).')
  }
  const codigos = new Set<string>()
  for (const n of novos) {
    if (codigos.has(n.codigo)) throw new Error(`Código repetido na importação: ${n.codigo}.`)
    codigos.add(n.codigo)
  }
  if (!dataIsoValida(dataPosicao)) {
    throw new Error('A data da posição é inválida. Use o formato aaaa-mm-dd.')
  }

  const [atuais, configuracoes] = await Promise.all([
    ler<Ativo[]>(cliente.from('ativos').select('*'), 'ativos'),
    ler<ConfiguracaoLinha[]>(cliente.from('configuracoes').select('chave,valor'), 'configuracoes'),
  ])
  const guardadosAtuais = lerConfiguracoes(configuracoes).alvosGuardados

  const { ativos, guardados } = aplicarImportacao(atuais, novos, guardadosAtuais)
  const antes = new Map(atuais.map((a) => [a.codigo, a]))
  const agora = new Date().toISOString()

  const inseridos = ativos.filter((a) => !antes.has(a.codigo)).map((a) => linhaAtivo(a))
  const alterados = ativos
    .filter((a) => {
      const anterior = antes.get(a.codigo)
      return anterior !== undefined && mudou(anterior, a)
    })
    .map((a) => linhaAtivo(a, agora))
  const removidos = atuais.filter((a) => !codigos.has(a.codigo)).map((a) => a.codigo)

  // defaultToNull: false -> coluna ausente usa o default do banco (atualizado_em = now()).
  const opcoesAtivos = { onConflict: 'codigo', defaultToNull: false }
  if (inseridos.length > 0) await gravar(cliente.from('ativos').upsert(inseridos, opcoesAtivos), 'ativos')
  if (alterados.length > 0) await gravar(cliente.from('ativos').upsert(alterados, opcoesAtivos), 'ativos')

  await gravar(
    cliente.from('configuracoes').upsert({ chave: CHAVE_ALVOS, valor: guardados }, { onConflict: 'chave' }),
    'alvos guardados',
  )

  if (removidos.length > 0) await gravar(cliente.from('ativos').delete().in('codigo', removidos), 'ativos')

  await gravar(
    cliente.from('importacoes').insert({ data_posicao: dataPosicao, arquivo, ativos: listaImportada(novos) }),
    'importacoes',
  )
}

/** Define o alvo (% da carteira) de cada ativo; `null` limpa o alvo. */
export async function salvarAlvos(
  alvos: Record<string, number | null>,
  cliente: ClienteBanco = obterSupabase(),
): Promise<void> {
  const entradas = Object.entries(alvos)
  for (const [codigo, pct] of entradas) {
    if (pct !== null && !(Number.isFinite(pct) && pct >= 0 && pct <= 100)) {
      throw new Error(`O alvo de ${codigo} precisa estar entre 0 e 100.`)
    }
  }
  for (const [codigo, pct] of entradas) {
    const linhas = await gravar(
      cliente.from('ativos').update({ alvo_pct: pct }).eq('codigo', codigo).select('codigo'),
      'alvos',
    )
    // Sem erro e sem linha: ativo inexistente ou sem permissão (a RLS não devolve erro).
    if (!Array.isArray(linhas) || linhas.length === 0) {
      throw new Error(`Não foi possível salvar o alvo de ${codigo}: ativo não encontrado ou sem permissão.`)
    }
  }
}

/** Limites do selo de faixa de 52 semanas: 0 ≤ barato < meio < teto ≤ 100. */
export async function salvarLimites(l: Limites, cliente: ClienteBanco = obterSupabase()): Promise<void> {
  if (!limitesValidos(l)) {
    throw new Error('Limites inválidos: use 0 ≤ barato < meio < teto ≤ 100.')
  }
  await gravar(
    cliente
      .from('configuracoes')
      .upsert(
        { chave: CHAVE_LIMITES, valor: { barato: l.barato, meio: l.meio, teto: l.teto } },
        { onConflict: 'chave' },
      ),
    'limites',
  )
}
