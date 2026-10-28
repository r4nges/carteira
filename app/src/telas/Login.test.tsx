import { fireEvent, render, screen } from '@testing-library/preact'
import { describe, expect, it, vi } from 'vitest'
import type { ClienteAuth } from '../lib/supabase'
import { Login } from './Login'

function authSimulado(resposta: unknown) {
  return {
    signInWithPassword: vi.fn().mockResolvedValue(resposta),
  } as unknown as Pick<ClienteAuth, 'signInWithPassword'> & {
    signInWithPassword: ReturnType<typeof vi.fn>
  }
}

function preencherEEnviar(email: string, senha: string) {
  fireEvent.input(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.input(screen.getByLabelText('Senha'), { target: { value: senha } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('Login', () => {
  it('envia e-mail e senha ao Supabase', async () => {
    const auth = authSimulado({ data: { session: { access_token: 'x' } }, error: null })
    render(<Login auth={auth} />)
    preencherEEnviar('pessoa@exemplo.com', 'segredo123')
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'pessoa@exemplo.com',
      password: 'segredo123',
    })
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Entrar' }).hasAttribute('disabled')).toBe(false),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mostra "E-mail ou senha incorretos." quando a credencial é recusada', async () => {
    const auth = authSimulado({
      data: { session: null, user: null },
      error: { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    })
    render(<Login auth={auth} />)
    preencherEEnviar('pessoa@exemplo.com', 'errada')
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toBe('E-mail ou senha incorretos.')
  })

  it('mostra outra mensagem quando a falha não é de credencial', async () => {
    const auth = {
      signInWithPassword: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    } as unknown as Pick<ClienteAuth, 'signInWithPassword'>
    render(<Login auth={auth} />)
    preencherEEnviar('pessoa@exemplo.com', 'segredo123')
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).not.toBe('E-mail ou senha incorretos.')
    expect(alerta.textContent).toMatch(/conexão/)
  })
})
