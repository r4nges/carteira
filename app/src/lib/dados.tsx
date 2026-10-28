import { createContext, type ComponentChildren, type VNode } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { carregarTudo, type DadosCarteira } from './banco'

export type EstadoDados = 'carregando' | 'pronto' | 'erro'

export interface ContextoDados {
  estado: EstadoDados
  /** Só existe com `estado === 'pronto'`: uma falha nunca vira carteira vazia. */
  dados: DadosCarteira | null
  erro: string | null
  /** Recarrega mostrando "carregando"/erro (ex.: depois de importar ou salvar). */
  recarregar: () => void
  /** Recarrega sem tirar os dados da tela; se falhar, mantém os dados e só registra. */
  atualizar: () => void
  /** Uma leitura está em andamento. */
  atualizando: boolean
  /** A última atualização silenciosa falhou (os dados na tela podem estar velhos). */
  falhaAtualizar: boolean
}

const MENSAGEM_GENERICA = 'Não foi possível carregar a carteira. Verifique a conexão e tente de novo.'

/** Intervalo da atualização periódica e idade mínima dos dados para recarregar ao voltar à aba. */
export const INTERVALO_ATUALIZACAO_MS = 5 * 60_000

const Contexto = createContext<ContextoDados | null>(null)

interface PropsProvider {
  /** Lê a carteira; por padrão o Supabase. Injetável para testes. */
  carregar?: () => Promise<DadosCarteira>
  children?: ComponentChildren
}

function abaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/**
 * Carrega a carteira ao montar e expõe `recarregar` (ex.: depois de importar). Com a aba visível,
 * atualiza sozinho a cada 5 min e ao voltar à aba depois de 5 min, sem tirar os dados da tela.
 */
export function DadosProvider({ carregar = carregarTudo, children }: PropsProvider) {
  const [estado, setEstado] = useState<EstadoDados>('carregando')
  const [dados, setDados] = useState<DadosCarteira | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)
  const [falhaAtualizar, setFalhaAtualizar] = useState(false)
  const carregarRef = useRef(carregar)
  carregarRef.current = carregar
  const estadoRef = useRef(estado)
  estadoRef.current = estado
  const temDadosRef = useRef(false)
  temDadosRef.current = dados !== null
  // Só a resposta da chamada mais recente vale; as antigas são descartadas.
  const geracao = useRef(0)
  // Instante (ms) da última leitura que deu certo.
  const ultimoSucesso = useRef<number | null>(null)

  const executar = useCallback((silencioso: boolean) => {
    const minha = ++geracao.current
    // Silencioso só faz sentido com dados na tela; sem eles, vale o fluxo normal (com erro visível).
    const quieto = silencioso && temDadosRef.current
    setAtualizando(true)
    if (!quieto) {
      // Com dados na tela, recarregar não troca tudo por "carregando".
      setEstado((atual) => (atual === 'pronto' ? atual : 'carregando'))
      setErro(null)
    }
    let promessa: Promise<DadosCarteira>
    try {
      promessa = Promise.resolve(carregarRef.current())
    } catch (e) {
      promessa = Promise.reject(e)
    }
    promessa.then(
      (novos) => {
        if (minha !== geracao.current) return
        ultimoSucesso.current = Date.now()
        setDados(novos)
        setEstado('pronto')
        setErro(null)
        setFalhaAtualizar(false)
        setAtualizando(false)
      },
      (e: unknown) => {
        if (minha !== geracao.current) return
        setAtualizando(false)
        if (quieto) {
          // Mantém os dados antigos: as marcas de "defasado" avisam o que estiver velho.
          console.error('Falha ao atualizar a carteira; mantendo os dados atuais.', e)
          setFalhaAtualizar(true)
          return
        }
        setDados(null)
        setErro(e instanceof Error && e.message ? e.message : MENSAGEM_GENERICA)
        setEstado('erro')
      },
    )
  }, [])

  const recarregar = useCallback(() => executar(false), [executar])
  const atualizar = useCallback(() => executar(true), [executar])

  useEffect(() => {
    executar(false)
    return () => {
      geracao.current++
    }
  }, [executar])

  // Aba aberta por horas (PWA instalado não tem botão de recarregar): renova sozinha enquanto visível.
  useEffect(() => {
    let relogio: ReturnType<typeof setInterval> | undefined
    const parar = () => {
      if (relogio !== undefined) clearInterval(relogio)
      relogio = undefined
    }
    const ocupado = () => estadoRef.current === 'carregando'
    const iniciar = () => {
      parar()
      relogio = setInterval(() => {
        if (abaVisivel() && !ocupado()) executar(true)
      }, INTERVALO_ATUALIZACAO_MS)
    }
    const aoMudarVisibilidade = () => {
      if (!abaVisivel()) {
        parar()
        return
      }
      const velho = ultimoSucesso.current === null || Date.now() - ultimoSucesso.current > INTERVALO_ATUALIZACAO_MS
      if (velho && !ocupado()) executar(true)
      iniciar()
    }
    if (abaVisivel()) iniciar()
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      parar()
    }
  }, [executar])

  const valor = useMemo(
    () => ({ estado, dados, erro, recarregar, atualizar, atualizando, falhaAtualizar }),
    [estado, dados, erro, recarregar, atualizar, atualizando, falhaAtualizar],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useDados(): ContextoDados {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useDados precisa estar dentro de um DadosProvider.')
  return ctx
}

interface PropsCarrega {
  children: (dados: DadosCarteira) => VNode | null
}

/** Mostra "carregando" ou o erro com "Tentar de novo"; com dados, chama `children`. */
export function CarregaDados({ children }: PropsCarrega) {
  const { estado, dados, erro, recarregar } = useDados()
  if (estado === 'erro' || (estado === 'pronto' && !dados)) {
    return (
      <div class="mensagem mensagem--erro" role="alert">
        <p>{erro ?? MENSAGEM_GENERICA}</p>
        <button type="button" class="botao botao--texto" onClick={recarregar}>
          Tentar de novo
        </button>
      </div>
    )
  }
  if (estado === 'carregando' || !dados) {
    return (
      <p class="mensagem" role="status">
        Carregando a carteira…
      </p>
    )
  }
  return children(dados)
}
