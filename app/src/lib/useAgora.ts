import { useEffect, useState } from 'preact/hooks'

const UM_MINUTO_MS = 60_000

/**
 * "Agora" que se renova sozinho: sem isso, uma aba aberta nunca percebe que a cotação envelheceu.
 * Com `fixo` (testes) devolve esse instante e não cria relógio.
 */
export function useAgora(fixo?: Date, intervaloMs = UM_MINUTO_MS): Date {
  const [agora, setAgora] = useState(() => new Date())

  useEffect(() => {
    if (fixo) return
    const id = setInterval(() => setAgora(new Date()), intervaloMs)
    return () => clearInterval(id)
  }, [fixo, intervaloMs])

  return fixo ?? agora
}
