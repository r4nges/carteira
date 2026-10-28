import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** O pedaço do cliente de autenticação que o app usa (facilita simular nos testes). */
export type ClienteAuth = Pick<
  SupabaseClient['auth'],
  'signInWithPassword' | 'getSession' | 'onAuthStateChange' | 'signOut'
>

export const MENSAGEM_CONFIG_AUSENTE =
  'Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em app/.env.local.'

let cliente: SupabaseClient | null = null

/**
 * Cliente criado sob demanda: importar este módulo não exige as variáveis de
 * ambiente nem abre conexão. Só a chave pública (anon) entra no app.
 */
export function obterSupabase(): SupabaseClient {
  if (cliente) return cliente
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !chave) throw new Error(MENSAGEM_CONFIG_AUSENTE)
  cliente = createClient(url, chave)
  return cliente
}
