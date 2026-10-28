import { render } from 'preact'
import { App } from './App'
import { obterSupabase } from './lib/supabase'
import '@fontsource-variable/figtree'
import '@fontsource-variable/bricolage-grotesque/wdth.css'
import './estilos/tokens.css'
import './estilos/base.css'

const raiz = document.getElementById('app')!

try {
  render(<App auth={obterSupabase().auth} />, raiz)
} catch (erro) {
  render(
    <div class="login">
      <p class="login__erro" role="alert">
        {erro instanceof Error ? erro.message : String(erro)}
      </p>
    </div>,
    raiz,
  )
}
