import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'preact/hooks'
import { Menu, ROTAS } from './componentes/Menu'
import type { DadosCarteira } from './lib/banco'
import { CarregaDados, DadosProvider, useDados } from './lib/dados'
import type { ClienteAuth } from './lib/supabase'
import type { Rota } from './lib/tipos'
import { Ativos } from './telas/Ativos'
import { Configuracoes } from './telas/Configuracoes'
import { Importar } from './telas/Importar'
import { Inicio } from './telas/Inicio'
import { Login } from './telas/Login'
import { Proventos } from './telas/Proventos'

interface Props {
  auth: ClienteAuth
  /** Lê a carteira; por padrão o Supabase. Injetável para testes. */
  carregarDados?: () => Promise<DadosCarteira>
}

// Tela provisória: a próxima tarefa a troca pela real.
const DESCRICAO_IMPORTAR = 'Importe a planilha de posição da Área do Investidor da B3.'

/** Telas que usam a carteira carregada; ficam dentro do DadosProvider. */
function Telas({ rota, aoNavegar, auth }: { rota: Rota; aoNavegar: (rota: Rota) => void; auth: ClienteAuth }) {
  const { recarregar, atualizar, atualizando, falhaAtualizar } = useDados()
  switch (rota) {
    case 'inicio':
      return (
        <CarregaDados>
          {(dados) => (
            <Inicio
              dados={dados}
              aoNavegar={aoNavegar}
              aoAtualizar={atualizar}
              atualizando={atualizando}
              falhaAtualizacao={falhaAtualizar}
            />
          )}
        </CarregaDados>
      )
    case 'ativos':
      return <CarregaDados>{(dados) => <Ativos dados={dados} aoNavegar={aoNavegar} />}</CarregaDados>
    case 'proventos':
      return <CarregaDados>{(dados) => <Proventos dados={dados} aoNavegar={aoNavegar} />}</CarregaDados>
    case 'config':
      return (
        <CarregaDados>
          {(dados) => (
            <Configuracoes
              dados={dados}
              aoSalvar={recarregar}
              aoNavegar={aoNavegar}
              aoSair={() => void auth.signOut()}
            />
          )}
        </CarregaDados>
      )
    case 'importar':
      return (
        <>
          <p class="conteudo__texto">{DESCRICAO_IMPORTAR}</p>
          <Importar aoSalvar={recarregar} />
        </>
      )
  }
}

export function App({ auth, carregarDados }: Props) {
  // undefined = ainda conferindo; null = sem sessão.
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined)
  const [rota, setRota] = useState<Rota>('inicio')

  useEffect(() => {
    let ativo = true
    auth
      .getSession()
      .then(({ data }) => {
        if (ativo) setSessao(data.session)
      })
      .catch(() => {
        if (ativo) setSessao(null)
      })
    const { data } = auth.onAuthStateChange((_evento, nova) => {
      if (ativo) setSessao(nova)
    })
    return () => {
      ativo = false
      data.subscription.unsubscribe()
    }
  }, [auth])

  if (sessao === undefined) return <div class="carregando" aria-busy="true" />
  if (sessao === null) return <Login auth={auth} />

  const titulo = ROTAS.find((r) => r.rota === rota)!.rotulo

  return (
    <DadosProvider carregar={carregarDados}>
      <div class="casca">
        <Menu rota={rota} aoNavegar={setRota} />
        <main class="conteudo">
          <h1 class="conteudo__titulo">{titulo}</h1>
          <Telas rota={rota} aoNavegar={setRota} auth={auth} />
        </main>
      </div>
    </DadosProvider>
  )
}
