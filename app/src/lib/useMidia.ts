import { useEffect, useState } from 'preact/hooks'

function consultar(consulta: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(consulta).matches
    : false
}

/** true enquanto a media query bate; acompanha mudanças de largura. */
export function useMidia(consulta: string): boolean {
  const [bate, setBate] = useState(() => consultar(consulta))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(consulta)
    const aoMudar = (e: MediaQueryListEvent) => setBate(e.matches)
    setBate(mql.matches)
    mql.addEventListener('change', aoMudar)
    return () => mql.removeEventListener('change', aoMudar)
  }, [consulta])

  return bate
}

/** Largura a partir da qual o menu vira barra lateral. */
export const CONSULTA_DESKTOP = '(min-width: 900px)'
