import type { JSX } from 'preact'
import { CONSULTA_DESKTOP, useMidia } from '../lib/useMidia'
import type { Rota } from '../lib/tipos'

export const ROTAS: { rota: Rota; rotulo: string; icone: JSX.Element }[] = [
  {
    rota: 'inicio',
    rotulo: 'Início',
    icone: <path d="M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z" />,
  },
  {
    rota: 'ativos',
    rotulo: 'Ativos',
    icone: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  },
  {
    rota: 'proventos',
    rotulo: 'Proventos',
    icone: (
      <path d="M5 8c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zm0 0v4c0 1.7 3.1 3 7 3s7-1.3 7-3V8m-14 4v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" />
    ),
  },
  {
    rota: 'importar',
    rotulo: 'Importar',
    icone: <path d="M12 4v10m-4-4 4 4 4-4M5 16v3.5h14V16" />,
  },
  {
    rota: 'config',
    rotulo: 'Configurações',
    icone: (
      <>
        <path d="M4 7h9.5M18.5 7H20M4 17h1.5M10.5 17H20" />
        <circle cx="16" cy="7" r="2.5" />
        <circle cx="8" cy="17" r="2.5" />
      </>
    ),
  },
]

interface Props {
  rota: Rota
  aoNavegar: (rota: Rota) => void
}

/** Barra lateral a partir de 900 px; barra inferior abaixo disso. */
export function Menu({ rota, aoNavegar }: Props) {
  const desktop = useMidia(CONSULTA_DESKTOP)
  const layout = desktop ? 'lateral' : 'inferior'

  return (
    <nav class={`menu menu--${layout}`} data-layout={layout} aria-label="Menu principal">
      {desktop && (
        <div class="menu__marca" aria-hidden="true">
          Carteira
        </div>
      )}
      <ul class="menu__lista">
        {ROTAS.map((item) => {
          const atual = item.rota === rota
          return (
            <li key={item.rota}>
              <button
                type="button"
                class="menu__item"
                aria-current={atual ? 'page' : undefined}
                onClick={() => aoNavegar(item.rota)}
              >
                <svg
                  class="menu__icone"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  {item.icone}
                </svg>
                <span class="menu__rotulo">{item.rotulo}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
