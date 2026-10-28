import { useState } from 'preact/hooks'
import type { ClienteAuth } from '../lib/supabase'

export const ERRO_CREDENCIAL = 'E-mail ou senha incorretos.'
export const ERRO_GERAL = 'Não foi possível entrar. Verifique a conexão e tente de novo.'

interface Props {
  auth: Pick<ClienteAuth, 'signInWithPassword'>
}

interface ErroAuth {
  code?: string
  message?: string
}

function ehErroDeCredencial(erro: ErroAuth): boolean {
  return erro.code === 'invalid_credentials' || /invalid login credentials/i.test(erro.message ?? '')
}

/** Entrada por e-mail e senha. A sessão aberta é percebida pelo App via onAuthStateChange. */
export function Login({ auth }: Props) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function entrar(e: Event) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      const { error } = await auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) setErro(ehErroDeCredencial(error) ? ERRO_CREDENCIAL : ERRO_GERAL)
    } catch {
      setErro(ERRO_GERAL)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div class="login">
      <form class="login__caixa" onSubmit={entrar} noValidate>
        <h1 class="login__titulo">Carteira</h1>
        <p class="login__texto">Entre com o e-mail e a senha da sua conta.</p>

        <label class="campo">
          <span class="campo__rotulo">E-mail</span>
          <input
            class="campo__entrada"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>

        <label class="campo">
          <span class="campo__rotulo">Senha</span>
          <input
            class="campo__entrada"
            type="password"
            name="senha"
            autoComplete="current-password"
            required
            value={senha}
            onInput={(e) => setSenha(e.currentTarget.value)}
          />
        </label>

        {erro && (
          <p class="login__erro" role="alert">
            {erro}
          </p>
        )}

        <button class="botao botao--primario" type="submit" disabled={enviando}>
          Entrar
        </button>
      </form>
    </div>
  )
}
