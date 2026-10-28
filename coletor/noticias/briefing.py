"""Texto de abertura do app: como o mercado está e qual ativo da carteira mais mexeu.

Texto de modelo, sem texto livre: só números e códigos que já estão no banco.
Formato pt-BR (vírgula decimal, ponto de milhar, `−` U+2212 para negativo).
Peças sem dado são omitidas; sem nenhuma peça, devolve string vazia (o app esconde o bloco).
"""
from __future__ import annotations

from datetime import datetime

MENOS = "−"


def _num(v: float, casas: int) -> str:
    """1234.5 -> '1.234,50'."""
    return f"{v:,.{casas}f}".replace(",", "\0").replace(".", ",").replace("\0", ".")


def _pct(v: float) -> str:
    """Uma casa e sinal explícito: +0,8% / −1,2%. O que arredonda para zero fica '0,0%'."""
    r = round(v, 1)
    if r == 0:
        return "0,0%"
    return f"{'+' if r > 0 else MENOS}{_num(abs(r), 1)}%"


def _aviso_defasado(ind: dict) -> str:
    if not ind.get("defasado"):
        return ""
    try:
        return f" (dado de {datetime.fromisoformat(ind['as_of']).strftime('%d/%m')})"
    except (TypeError, ValueError, KeyError):
        return " (dado defasado)"


def _ibovespa(ind: dict | None) -> str | None:
    if not ind or ind.get("variacao_dia_pct") is None:
        return None
    return f"Ibovespa {_pct(ind['variacao_dia_pct'])}{_aviso_defasado(ind)}"


def _dolar(ind: dict | None) -> str | None:
    if not ind or ind.get("valor") is None:
        return None
    var = ind.get("variacao_dia_pct")
    return f"dólar R$ {_num(ind['valor'], 2)}{'' if var is None else f' ({_pct(var)})'}{_aviso_defasado(ind)}"


def _destaque(cotacoes: list[dict], ativos: list[dict]) -> str | None:
    """Ativo de maior |variação em R$| = quantidade × (preço − fechamento anterior).

    Entram só linhas com preço e fechamento anterior, e que não estejam defasadas
    (a variação de um dia velho não é a de hoje). Linha de falha não tem preço.
    """
    qtd = {a["codigo"]: float(a.get("quantidade") or 0) for a in ativos}
    melhor = None  # (|R$|, código, variação %)
    for c in cotacoes:
        prev, preco = c.get("prev_close"), c.get("preco")
        if c.get("erro") or c.get("defasado") or not prev or preco is None or not qtd.get(c.get("codigo")):
            continue
        reais = abs(qtd[c["codigo"]] * (preco - prev))
        if reais == 0 or (melhor is not None and reais <= melhor[0]):
            continue
        var = c.get("variacao_dia_pct")
        melhor = (reais, c["codigo"], (preco / prev - 1) * 100 if var is None else var)
    if melhor is None:
        return None
    return f"Maior destaque na sua carteira: {melhor[1]} ({_pct(melhor[2])})."


def texto_mercado(indices: dict, cotacoes: list[dict], ativos: list[dict]) -> str:
    """Ex.: 'Ibovespa −1,2% e dólar R$ 5,60 (+0,8%). Maior destaque na sua carteira: ACAO4 (−2,1%).'

    `indices` vem de `coletar_indices` (chaves IBOV e USDBRL), `cotacoes` são as
    linhas da tabela `cotacoes` desta rodada e `ativos` trazem a quantidade.
    """
    partes = [p for p in (_ibovespa(indices.get("IBOV")), _dolar(indices.get("USDBRL"))) if p]
    frases = []
    if partes:
        frase = " e ".join(partes)
        frases.append(f"{frase[0].upper()}{frase[1:]}.")
    destaque = _destaque(cotacoes, ativos)
    if destaque:
        frases.append(destaque)
    return " ".join(frases)
