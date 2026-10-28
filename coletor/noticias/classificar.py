"""Classificação das notícias: ativos citados, tags macro, agrupamento e ranking.

Tudo função pura sobre os itens de `feed.parse_feed` (sem rede, só stdlib).
O texto é sempre normalizado (sem acento, minúsculo, só letras e dígitos) antes
de qualquer comparação, e os casamentos respeitam borda de palavra.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timedelta

JANELA_GRUPO = timedelta(hours=24)
JACCARD_MIN = 0.6
MEIA_VIDA_H = 12  # a nota cai pela metade a cada 12 h de idade
ALIAS_MIN = 4  # nome curto abaixo disso gera falso positivo demais

_PALAVRA = re.compile(r"[a-z0-9]+")

# Palavras sem valor para comparar títulos (e que nunca viram alias de ativo).
STOPWORDS = frozenset("""
a ao aos as com como da das de dela dele do dos e ela ele em entre era essa esse esta este eu foi ha isso isto
ja la mais mas me mesmo meu na nas nem no nos nossa nosso num numa o os ou para pela pelas pelo pelos por qual
quando que quem se sem ser seu sua tambem te tem um uma voce apos ate sobre diz hoje ontem amanha veja saiba
""".split())

# Verbos neutros de mercado: "fecha em alta" e "sobe" contam a mesma coisa.
_NEUTROS = frozenset("""
fecha fecham fechou abre abrem abriu encerra encerram encerrou opera operam operou termina terminam terminou
""".split())
_ALTA = frozenset("sobe sobem subiu alta altas avanca avancam avancou dispara disparam disparou salta valoriza valorizam valorizou".split())
_QUEDA = frozenset("cai caem caiu queda quedas recua recuam recuou despenca despencam desaba desabam baixa desvaloriza desvalorizam".split())

# Partes do `produto` que não identificam a empresa (sufixo societário, gênero do fundo, classe da ação).
_SUFIXOS = frozenset("""
s a sa ltda fii fundo fdo investimento investimentos imobiliario imobiliarios participacoes holding cia companhia
on pn nm n1 n2 ed ej unit units
""".split()) | STOPWORDS
# Palavras comuns demais para identificar sozinhas uma empresa numa manchete.
_GENERICAS = frozenset("banco brasil brasileiro brasileira nacional energia grupo industria comercio servicos".split())

_TAGS_MACRO = {
    "juros": r"copom|selic|juros?|cdi|taxa basica",
    "cambio": r"dolar|dolares|cambio",
    "fiscal": r"fiscal|fiscais|arcabouco|divida publica|deficit|superavit|teto de gastos|gastos publicos|orcamento",
    "eleicoes": r"eleicao|eleicoes|eleitoral|eleitorais|primeiro turno|segundo turno|urnas?|candidat[oa]s?",
    "bolsa": r"bolsa|ibovespa|ibov|b3",
    "petroleo": r"petroleo|brent|opep|opec|barris?",
}
_TAGS_RE = {tag: re.compile(rf"\b(?:{padrao})\b") for tag, padrao in _TAGS_MACRO.items()}


def normalizar(texto: str) -> str:
    """Sem acento e minúsculo."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sem_acento if not unicodedata.combining(c)).lower()


def _palavras(texto: str) -> list[str]:
    return _PALAVRA.findall(normalizar(texto))


def _texto_item(item: dict) -> str:
    """Título e lide como palavras normalizadas separadas por espaço (borda de palavra = espaço)."""
    return " ".join(_palavras(f"{item.get('titulo', '')} {item.get('lide', '')}"))


def aliases(ativo: dict) -> list[str]:
    """Código e nome curto do `produto`, normalizados.

    "ACAO4 - ACME S.A." dá ["acao4", "acme"]. O nome sai sem sufixo societário;
    se sobrar só palavra genérica ou algo com menos de 4 letras, fica só o código.
    """
    codigo = normalizar(ativo.get("codigo") or "").strip()
    saida = [codigo] if codigo else []
    produto = normalizar(ativo.get("produto") or "").replace(".", "")
    nome = produto.split(" - ", 1)[1] if " - " in produto else produto
    palavras = [p for p in _PALAVRA.findall(nome) if p not in _SUFIXOS and p != codigo]
    curto = " ".join(palavras)
    if palavras and not all(p in _GENERICAS for p in palavras) and len(curto) >= ALIAS_MIN and curto not in saida:
        saida.append(curto)
    return saida


def marcar_ativos(item: dict, ativos: list[dict]) -> list[str]:
    """Códigos dos ativos citados no título ou no lide, na ordem da carteira, sem repetir."""
    texto = f" {_texto_item(item)} "
    return [a["codigo"] for a in ativos
            if any(f" {alias} " in texto for alias in aliases(a))]


def tags_macro(item: dict) -> list[str]:
    """Temas macro do título e do lide: subconjunto (em ordem alfabética) de juros, cambio, fiscal, eleicoes, bolsa, petroleo."""
    texto = _texto_item(item)
    return sorted(tag for tag, padrao in _TAGS_RE.items() if padrao.search(texto))


def _tokens_titulo(titulo: str) -> frozenset[str]:
    """Palavras que contam na comparação de títulos; sinônimos de alta/queda viram uma só."""
    saida = set()
    for p in _palavras(titulo):
        if p in STOPWORDS or p in _NEUTROS:
            continue
        saida.add("#alta" if p in _ALTA else "#queda" if p in _QUEDA else p)
    return frozenset(saida)


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def agrupar(itens: list[dict]) -> list[dict]:
    """Junta a mesma notícia dada por fontes diferentes e devolve só o representante de cada grupo.

    Títulos com Jaccard >= 0.6, publicados com até 24 h de diferença, de fontes
    diferentes. O representante é o de maior peso (empate: o mais antigo); ele
    ganha `grupo_id` (hash do título normalizado, estável entre execuções) e
    `tambem_em` (as outras fontes). Mantém a ordem de entrada e não altera os itens recebidos.
    """
    ordem = sorted(range(len(itens)), key=lambda i: (
        -itens[i]["peso"], itens[i]["publicado_em"], itens[i]["fonte"], itens[i]["titulo"]))
    grupos: list[dict] = []
    for i in ordem:
        item = itens[i]
        tokens = _tokens_titulo(item["titulo"])
        for g in grupos:
            if (item["fonte"] not in g["fontes"]
                    and abs(item["publicado_em"] - g["rep"]["publicado_em"]) <= JANELA_GRUPO
                    and _jaccard(tokens, g["tokens"]) >= JACCARD_MIN):
                g["fontes"].append(item["fonte"])
                break
        else:
            grupos.append({"idx": i, "rep": item, "tokens": tokens, "fontes": [item["fonte"]]})

    saida = []
    for g in sorted(grupos, key=lambda g: g["idx"]):
        rep = dict(g["rep"])
        rep["grupo_id"] = hashlib.sha1(" ".join(_palavras(rep["titulo"])).encode()).hexdigest()[:12]
        rep["tambem_em"] = g["fontes"][1:]
        saida.append(rep)
    return saida


def pontuar(item: dict, agora: datetime) -> float:
    """Nota de relevância: peso × 0.5 ** (idade_em_horas / 12) × (1 + 2*cita_ativo + 0.5*n_tags).

    Usa `item["ativos"]` e `item["tags"]` quando já preenchidos; sem `tags`, calcula do texto.
    """
    idade_h = max(0.0, (agora - item["publicado_em"]).total_seconds() / 3600)
    cita = 1 if item.get("ativos") else 0
    tags = item["tags"] if "tags" in item else tags_macro(item)
    return item["peso"] * 0.5 ** (idade_h / MEIA_VIDA_H) * (1 + 2 * cita + 0.5 * len(tags))
