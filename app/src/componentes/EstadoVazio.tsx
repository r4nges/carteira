import type { Rota } from '../lib/tipos'

interface Props {
  aoNavegar?: (rota: Rota) => void
}

/** Carteira sem nenhum ativo: o único caminho útil é importar a planilha. */
export function EstadoVazio({ aoNavegar }: Props) {
  return (
    <div class="vazio">
      <p>Nenhum ativo ainda. Importe sua carteira.</p>
      <button type="button" class="botao botao--primario" onClick={() => aoNavegar?.('importar')}>
        Ir para Importar
      </button>
    </div>
  )
}
