import type { Ativo } from './tipos'

/**
 * Linha de posição lida da planilha da B3. Só estes campos saem do arquivo:
 * nada de CPF, CNPJ, conta ou instituição.
 */
export interface AtivoImportado {
  codigo: string
  tipo: Ativo['tipo']
  produto: string
  quantidade: number
  preco_fechamento: number | null
  valor_atualizado: number | null
  vencimento: string | null
  tesouro_tipo: string | null
}

/**
 * Aplica a posição importada sobre a carteira atual, preservando os alvos.
 *
 * - ativo que continua: mantém o `alvo_pct` (se estiver vazio, recupera o guardado);
 * - ativo novo: recupera o alvo guardado, ou fica sem alvo;
 * - ativo que sumiu: sai de `ativos` e o alvo (se houver) vai para `guardados`.
 *
 * Função pura: não altera nenhum dos argumentos.
 */
export function aplicarImportacao(
  atuais: Ativo[],
  novos: AtivoImportado[],
  guardados: Record<string, number>,
): { ativos: Ativo[]; guardados: Record<string, number> } {
  const porCodigo = new Map(atuais.map((a) => [a.codigo, a]))
  const restantes: Record<string, number> = { ...guardados }

  const ativos = novos.map((n): Ativo => {
    const existente = porCodigo.get(n.codigo)
    const guardado = Object.hasOwn(restantes, n.codigo) ? restantes[n.codigo] : null
    delete restantes[n.codigo]
    return {
      codigo: n.codigo,
      tipo: n.tipo,
      produto: n.produto,
      quantidade: n.quantidade,
      valor_atualizado: n.valor_atualizado,
      preco_fechamento: n.preco_fechamento,
      vencimento: n.vencimento,
      tesouro_tipo: n.tesouro_tipo,
      alvo_pct: existente?.alvo_pct ?? guardado,
      atualizado_em: existente?.atualizado_em ?? null,
    }
  })

  const presentes = new Set(novos.map((n) => n.codigo))
  for (const a of atuais) {
    if (!presentes.has(a.codigo) && a.alvo_pct != null) restantes[a.codigo] = a.alvo_pct
  }

  return { ativos, guardados: restantes }
}
