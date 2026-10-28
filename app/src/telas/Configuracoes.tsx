import { useRef, useState } from 'preact/hooks'
import { EstadoVazio } from '../componentes/EstadoVazio'
import { salvarAlvos as salvarAlvosBanco, salvarLimites as salvarLimitesBanco, type DadosCarteira } from '../lib/banco'
import { quantidade } from '../lib/formato'
import type { Limites } from '../lib/metricas'
import type { Ativo, Rota } from '../lib/tipos'

interface Props {
  dados: DadosCarteira
  /** Recarrega a carteira depois de salvar (ou de uma falha parcial). */
  aoSalvar?: () => void
  /** Encerra a sessão (o mesmo `signOut` do login). */
  aoSair: () => void
  aoNavegar?: (rota: Rota) => void
  /** Gravação dos alvos; por padrão o Supabase. Injetável para testes. */
  salvarAlvos?: (alvos: Record<string, number | null>) => Promise<void>
  /** Gravação dos limites do selo; por padrão o Supabase. Injetável para testes. */
  salvarLimites?: (limites: Limites) => Promise<void>
}

type Leitura = { tipo: 'vazio' } | { tipo: 'valor'; valor: number } | { tipo: 'erro'; mensagem: string }

const MSG_NUMERO = 'Use um número, como 12,5.'
const MSG_NEGATIVO = 'O alvo não pode ser negativo.'
const MSG_MAIOR = 'O alvo não pode passar de 100%.'
const MSG_LIMITE_FAIXA = 'Cada limite precisa ser um número entre 0 e 100.'
const MSG_LIMITE_ORDEM = 'Os limites precisam estar em ordem crescente: barato < meio < teto.'

/** Dígitos com vírgula ou ponto decimal; nada de notação científica, NaN ou Infinity. */
const NUMERO = /^[-+]?\d+(?:[.,]\d+)?$/

function lerNumero(texto: string): { tipo: 'vazio' } | { tipo: 'numero'; valor: number } | { tipo: 'invalido' } {
  const t = texto.trim()
  if (t === '') return { tipo: 'vazio' }
  if (!NUMERO.test(t)) return { tipo: 'invalido' }
  const valor = Number(t.replace(',', '.'))
  if (!Number.isFinite(valor)) return { tipo: 'invalido' }
  return { tipo: 'numero', valor: valor === 0 ? 0 : valor }
}

function lerAlvo(texto: string): Leitura {
  const n = lerNumero(texto)
  if (n.tipo === 'vazio') return { tipo: 'vazio' }
  if (n.tipo === 'invalido') return { tipo: 'erro', mensagem: MSG_NUMERO }
  if (n.valor < 0) return { tipo: 'erro', mensagem: MSG_NEGATIVO }
  if (n.valor > 100) return { tipo: 'erro', mensagem: MSG_MAIOR }
  return { tipo: 'valor', valor: n.valor }
}

/** Limite: vazio não vale (não pode virar 0 em silêncio). */
function lerLimite(texto: string): number | null {
  const n = lerNumero(texto)
  return n.tipo === 'numero' && n.valor >= 0 && n.valor <= 100 ? n.valor : null
}

/** Tira o ruído de ponto flutuante (0,1 + 0,2) sem esconder casas reais. */
function limpar(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function alvoAtual(a: Ativo): number | null {
  return typeof a.alvo_pct === 'number' && Number.isFinite(a.alvo_pct) ? a.alvo_pct : null
}

function ehBolsa(a: Ativo): boolean {
  return a.tipo !== 'Tesouro Direto' && a.tipo !== 'Renda fixa'
}

function textoDe(n: number | null): string {
  return n === null ? '' : quantidade(n)
}

function mensagemDeErro(erro: unknown, base: string): string {
  if (erro instanceof Error && erro.message) {
    return erro.message.startsWith('Não foi possível') ? erro.message : `${base} ${erro.message}`
  }
  return `${base} Verifique a conexão e tente de novo.`
}

interface Retorno {
  tipo: 'ok' | 'erro'
  texto: string
}

function Feedback({ r }: { r: Retorno | null }) {
  if (!r) return null
  return r.tipo === 'ok' ? (
    <p class="mensagem mensagem--ok" role="status">
      {r.texto}
    </p>
  ) : (
    <p class="mensagem mensagem--erro" role="alert">
      {r.texto}
    </p>
  )
}

function SecaoAlvos({
  dados,
  aoSalvar,
  aoNavegar,
  salvarAlvos,
}: Pick<Props, 'dados' | 'aoSalvar' | 'aoNavegar'> & { salvarAlvos: NonNullable<Props['salvarAlvos']> }) {
  // Só o que o usuário digitou; o resto vem do banco (não some quando a carteira recarrega).
  const [edicoes, setEdicoes] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const [retorno, setRetorno] = useState<Retorno | null>(null)
  const emAndamento = useRef(false)

  const ativos = [...dados.ativos].sort(
    (a, b) => Number(!ehBolsa(a)) - Number(!ehBolsa(b)) || a.codigo.localeCompare(b.codigo),
  )

  if (ativos.length === 0) {
    return <EstadoVazio aoNavegar={aoNavegar} />
  }

  const linhas = ativos.map((a) => {
    const texto = edicoes[a.codigo] ?? textoDe(alvoAtual(a))
    return { ativo: a, texto, leitura: lerAlvo(texto) }
  })

  const invalido = linhas.some((l) => l.leitura.tipo === 'erro')
  const mudancas: Record<string, number | null> = {}
  let soma = 0
  let definidos = 0
  for (const l of linhas) {
    if (l.leitura.tipo === 'erro') continue
    const novo = l.leitura.tipo === 'valor' ? l.leitura.valor : null
    if (novo !== null) {
      soma += novo
      definidos++
    }
    if (novo !== alvoAtual(l.ativo)) mudancas[l.ativo.codigo] = novo
  }
  soma = limpar(soma)
  const podeSalvar = !invalido && !salvando && Object.keys(mudancas).length > 0

  function digitar(codigo: string, texto: string) {
    setEdicoes((e) => ({ ...e, [codigo]: texto }))
    setRetorno(null)
  }

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    emAndamento.current = true
    setSalvando(true)
    setRetorno(null)
    try {
      await salvarAlvos(mudancas)
      setRetorno({ tipo: 'ok', texto: 'Alvos salvos.' })
      aoSalvar?.()
    } catch (erro) {
      setRetorno({ tipo: 'erro', texto: mensagemDeErro(erro, 'Não foi possível salvar os alvos.') })
      // O salvamento não é atômico: parte dos alvos pode ter sido gravada. Relê o banco.
      aoSalvar?.()
    } finally {
      emAndamento.current = false
      setSalvando(false)
    }
  }

  return (
    <section class="config__secao" aria-labelledby="config-alvos">
      <h2 class="importar__subtitulo" id="config-alvos">
        Alvos por ativo
      </h2>
      <p class="config__nota">
        Percentual da carteira que você quer em cada ativo. Ativo sem alvo fica fora do cálculo de diferença.
      </p>
      <ul class="alvos">
        {linhas.map(({ ativo: a, texto, leitura }) => {
          const idErro = `alvo-erro-${a.codigo}`
          const erro = leitura.tipo === 'erro' ? leitura.mensagem : null
          return (
            <li key={a.codigo} class="alvos__item">
              <div class="alvos__ativo">
                <label class="tabela__codigo" for={`alvo-${a.codigo}`}>
                  {`Alvo de ${a.codigo} (%)`}
                </label>
                {a.tipo && <span class="ativos__detalhe">{a.tipo}</span>}
              </div>
              <input
                id={`alvo-${a.codigo}`}
                class="campo__entrada num alvos__entrada"
                type="text"
                inputMode="decimal"
                autocomplete="off"
                value={texto}
                aria-invalid={erro ? 'true' : undefined}
                aria-describedby={erro ? idErro : undefined}
                onInput={(e) => digitar(a.codigo, (e.currentTarget as HTMLInputElement).value)}
              />
              {erro && (
                <p class="alvos__erro baixa" id={idErro} role="alert">
                  {erro}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {definidos === 0 ? (
        <p class="mensagem" role="status">
          Nenhum alvo definido.
        </p>
      ) : soma === 100 ? (
        <p class="mensagem mensagem--ok" role="status">
          Os alvos somam 100%.
        </p>
      ) : (
        <p class="mensagem mensagem--aviso" role="status">
          {`Os alvos somam ${quantidade(soma)}%, não 100%.`}
        </p>
      )}

      <Feedback r={retorno} />
      <div class="importar__acoes">
        <button
          type="button"
          class="botao botao--primario"
          disabled={!podeSalvar}
          aria-busy={salvando ? 'true' : undefined}
          onClick={() => void salvar()}
        >
          {salvando ? 'Salvando alvos…' : 'Salvar alvos'}
        </button>
      </div>
    </section>
  )
}

const CAMPOS_LIMITE = [
  { chave: 'barato', rotulo: 'Barato até (%)' },
  { chave: 'meio', rotulo: 'No meio até (%)' },
  { chave: 'teto', rotulo: 'Perto do teto até (%)' },
] as const satisfies readonly { chave: keyof Limites; rotulo: string }[]

function SecaoLimites({
  dados,
  aoSalvar,
  salvarLimites,
}: Pick<Props, 'dados' | 'aoSalvar'> & { salvarLimites: NonNullable<Props['salvarLimites']> }) {
  const atuais = dados.config.limites
  const [edicoes, setEdicoes] = useState<Partial<Record<keyof Limites, string>>>({})
  const [salvando, setSalvando] = useState(false)
  const [retorno, setRetorno] = useState<Retorno | null>(null)
  const emAndamento = useRef(false)

  const textos = {
    barato: edicoes.barato ?? textoDe(atuais.barato),
    meio: edicoes.meio ?? textoDe(atuais.meio),
    teto: edicoes.teto ?? textoDe(atuais.teto),
  }
  const lidos = {
    barato: lerLimite(textos.barato),
    meio: lerLimite(textos.meio),
    teto: lerLimite(textos.teto),
  }

  const foraDaFaixa = CAMPOS_LIMITE.filter((c) => lidos[c.chave] === null).map((c) => c.chave)
  const novo: Limites | null =
    lidos.barato !== null && lidos.meio !== null && lidos.teto !== null
      ? { barato: lidos.barato, meio: lidos.meio, teto: lidos.teto }
      : null
  const foraDeOrdem = novo !== null && !(novo.barato < novo.meio && novo.meio < novo.teto)
  const mensagemErro = foraDaFaixa.length > 0 ? MSG_LIMITE_FAIXA : foraDeOrdem ? MSG_LIMITE_ORDEM : null
  const comErro = (chave: keyof Limites) => (foraDaFaixa.length > 0 ? foraDaFaixa.includes(chave) : foraDeOrdem)

  const mudou =
    novo !== null && (novo.barato !== atuais.barato || novo.meio !== atuais.meio || novo.teto !== atuais.teto)
  const podeSalvar = novo !== null && !foraDeOrdem && mudou && !salvando

  // Descrição das faixas com o que está digitado (ou o salvo, enquanto o campo é inválido).
  const efetivo: Limites = {
    barato: lidos.barato ?? atuais.barato,
    meio: lidos.meio ?? atuais.meio,
    teto: lidos.teto ?? atuais.teto,
  }

  function digitar(chave: keyof Limites, texto: string) {
    setEdicoes((e) => ({ ...e, [chave]: texto }))
    setRetorno(null)
  }

  async function salvar() {
    if (!podeSalvar || !novo || emAndamento.current) return
    emAndamento.current = true
    setSalvando(true)
    setRetorno(null)
    try {
      await salvarLimites(novo)
      setRetorno({ tipo: 'ok', texto: 'Limites salvos.' })
      aoSalvar?.()
    } catch (erro) {
      setRetorno({ tipo: 'erro', texto: mensagemDeErro(erro, 'Não foi possível salvar os limites.') })
    } finally {
      emAndamento.current = false
      setSalvando(false)
    }
  }

  return (
    <section class="config__secao" aria-labelledby="config-limites">
      <h2 class="importar__subtitulo" id="config-limites">
        Limites do selo
      </h2>
      <p class="config__nota">
        {`O selo descreve onde o preço está na faixa de 52 semanas: Barato até ${quantidade(efetivo.barato)}%, No meio até ${quantidade(efetivo.meio)}%, Perto do teto até ${quantidade(efetivo.teto)}%, Esticado acima disso.`}
      </p>
      <div class="limites">
        {CAMPOS_LIMITE.map(({ chave, rotulo }) => (
          <div key={chave} class="campo">
            <label class="campo__rotulo" for={`limite-${chave}`}>
              {rotulo}
            </label>
            <input
              id={`limite-${chave}`}
              class="campo__entrada num"
              type="text"
              inputMode="decimal"
              autocomplete="off"
              value={textos[chave]}
              aria-invalid={mensagemErro && comErro(chave) ? 'true' : undefined}
              aria-describedby={mensagemErro && comErro(chave) ? 'limites-erro' : undefined}
              onInput={(e) => digitar(chave, (e.currentTarget as HTMLInputElement).value)}
            />
          </div>
        ))}
      </div>
      {mensagemErro && (
        <p class="mensagem mensagem--erro" id="limites-erro" role="alert">
          {mensagemErro}
        </p>
      )}
      <Feedback r={retorno} />
      <div class="importar__acoes">
        <button
          type="button"
          class="botao botao--primario"
          disabled={!podeSalvar}
          aria-busy={salvando ? 'true' : undefined}
          onClick={() => void salvar()}
        >
          {salvando ? 'Salvando limites…' : 'Salvar limites'}
        </button>
      </div>
    </section>
  )
}

/** Alvos por ativo, limites do selo e Sair. */
export function Configuracoes({
  dados,
  aoSalvar,
  aoSair,
  aoNavegar,
  salvarAlvos = salvarAlvosBanco,
  salvarLimites = salvarLimitesBanco,
}: Props) {
  return (
    <div class="config">
      <SecaoAlvos dados={dados} aoSalvar={aoSalvar} aoNavegar={aoNavegar} salvarAlvos={salvarAlvos} />
      <SecaoLimites dados={dados} aoSalvar={aoSalvar} salvarLimites={salvarLimites} />
      <section class="config__secao" aria-labelledby="config-conta">
        <h2 class="importar__subtitulo" id="config-conta">
          Conta
        </h2>
        <div class="importar__acoes">
          <button type="button" class="botao" onClick={aoSair}>
            Sair
          </button>
        </div>
      </section>
    </div>
  )
}
