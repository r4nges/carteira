import { cleanup } from '@testing-library/preact'
import { afterEach, vi } from 'vitest'

type Ouvinte = (e: MediaQueryListEvent) => void

/**
 * Substitui window.matchMedia (o jsdom não tem). Só entende "(min-width: Npx)";
 * `largura` decide se a consulta bate.
 */
export function simularLargura(largura: number) {
  const ouvintes = new Map<Ouvinte, string>()
  const bate = (media: string) => {
    const m = /min-width:\s*(\d+)px/.exec(media)
    return m ? largura >= Number(m[1]) : false
  }
  window.matchMedia = vi.fn((media: string) => {
    const mql = {
      media,
      get matches() {
        return bate(media)
      },
      onchange: null,
      addEventListener: (_: string, f: Ouvinte) => ouvintes.set(f, media),
      removeEventListener: (_: string, f: Ouvinte) => ouvintes.delete(f),
      addListener: (f: Ouvinte) => ouvintes.set(f, media),
      removeListener: (f: Ouvinte) => ouvintes.delete(f),
      dispatchEvent: () => true,
    }
    return mql as unknown as MediaQueryList
  })
  return {
    /** Muda a largura e avisa quem está ouvindo, como o navegador faz. */
    redimensionar(nova: number) {
      largura = nova
      for (const [f, media] of ouvintes) {
        f({ matches: bate(media), media } as MediaQueryListEvent)
      }
    },
  }
}

simularLargura(1280)

afterEach(() => {
  cleanup()
  simularLargura(1280)
})
