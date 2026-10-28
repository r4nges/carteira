import { afterEach, describe, expect, it, vi } from 'vitest'

describe('obterSupabase', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('importar o módulo não exige as variáveis de ambiente', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('./supabase')).resolves.toBeTruthy()
  })

  it('sem as variáveis, falha com mensagem em pt-BR', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { obterSupabase, MENSAGEM_CONFIG_AUSENTE } = await import('./supabase')
    expect(() => obterSupabase()).toThrow(MENSAGEM_CONFIG_AUSENTE)
  })
})
