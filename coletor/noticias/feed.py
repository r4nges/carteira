"""Leitura de feeds RSS/Atom: baixa, limpa e extrai só título, lide e link.

O app nunca guarda o texto completo da matéria: do corpo do feed sai apenas a
abertura (lide) do próprio veículo, com cerca de 300 caracteres.
XML de fora só é lido com defusedxml (sem entidades externas nem bombas XML).
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from defusedxml import ElementTree as ET

LIDE_MAX = 300
MAX_FRASES = 3
TITULO_MAX = 300
_MAX_RODADAS = 10  # teto de segurança do saneamento; escape legítimo não passa de 2 ou 3 níveis
TOLERANCIA_FUTURO = timedelta(hours=1)  # relógio de veículo adiantado vale; mais que isso é lixo

_BLOCOS = re.compile(r"(?i)</?(?:p|br|div|li|ul|ol|h[1-6]|tr|blockquote)\b[^>]*>")
_SCRIPTS = re.compile(r"(?is)<(script|style)\b.*?</\1\s*>")
_TAGS = re.compile(r"<[A-Za-z/!][^>]*>")  # só tag de verdade; os < e > soltos saem no passe final de _limpar
_ESPACOS = re.compile(r"\s+")
_FIM_FRASE = re.compile(r"(?<=[.!?…])\s+")
_DECLARACAO_XML = re.compile(rb"^\s*<\?xml[^>]*\?>")


def baixar(url: str) -> bytes:
    """GET do feed com o get() do coletor (retry, sem query string nos erros)."""
    # import tardio: coletor.py importa este pacote, então o ciclo só existe no topo do módulo
    from coletor import get

    return get(url, headers={"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
               timeout=20, retries=1).content


def _limpar(texto: str | None) -> str:
    """Tira scripts, tags e entidades HTML, junta espaços e nunca devolve '<' nem '>'.

    Desescapa antes de tirar as tags e repete até o texto parar de mudar, porque
    feed com HTML escapado várias vezes (&amp;lt;p&amp;gt;) só vira tag depois de
    várias rodadas. O teto de rodadas garante que termina até com aninhamento
    adversarial. No fim, qualquer '<' ou '>' que sobrar (texto puro como "a < b",
    ou resto de um aninhamento além do teto) vira espaço: o resultado nunca
    contém marcação, ao custo de perder os sinais de comparação do texto.
    """
    if not texto:
        return ""
    t = texto
    for _ in range(_MAX_RODADAS):
        anterior = t
        t = html.unescape(t)
        t = _SCRIPTS.sub(" ", t)
        t = _BLOCOS.sub(" ", t)
        t = _TAGS.sub("", t)
        if t == anterior:
            break
    t = t.replace("<", " ").replace(">", " ")
    return _ESPACOS.sub(" ", t).strip()


def _cortar(t: str, limite: int) -> str:
    """Corta em limite de palavra, terminando em '…', com no máximo `limite` caracteres."""
    corte = t[: limite - 1]
    if t[limite - 1] != " " and " " in corte:
        corte = corte.rsplit(" ", 1)[0]
    return corte.rstrip(" ,;:-–") + "…"


def extrair_lide(texto: str, limite: int = LIDE_MAX) -> str:
    """Abertura do texto: até 3 frases inteiras que caibam no limite.

    Se nem a primeira frase cabe, corta no limite de palavra e termina em '…'.
    """
    t = _limpar(texto)
    if len(t) <= limite:
        return t
    frases = _FIM_FRASE.split(t)
    if len(frases[0]) > limite:
        return _cortar(t, limite)
    lide = frases[0]
    for f in frases[1:MAX_FRASES]:
        if len(lide) + 1 + len(f) > limite:
            break
        lide += " " + f
    return lide


def _tag(el) -> str:
    """Nome da tag sem namespace."""
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def _data(s: str | None) -> datetime | None:
    """Data RFC 822 (RSS) ou ISO 8601 (Atom, dc:date) -> datetime em UTC; None se inválida."""
    if not s or not s.strip():
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _link(item) -> str:
    """URL da matéria: <link>texto</link> (RSS) ou <link href=...> alternate (Atom)."""
    for c in item:
        if _tag(c) != "link":
            continue
        href = (c.get("href") or "").strip()
        if href and c.get("rel", "alternate") == "alternate":
            return href
        if (c.text or "").strip():
            return c.text.strip()
    return ""


def _url_valida(url: str) -> bool:
    """Só http/https com host (descarta javascript:, data: e caminhos relativos)."""
    try:
        p = urlsplit(url)
    except ValueError:  # ex.: "http://[abc" (IPv6 malformado): descarta só o item
        return False
    return p.scheme.lower() in ("http", "https") and bool(p.netloc)


def _texto(item, *nomes: str) -> str:
    """Primeiro filho com uma das tags (na ordem dada) que tenha texto."""
    for nome in nomes:
        for c in item:
            if _tag(c) == nome and (c.text or "").strip():
                return c.text
    return ""


def parse_feed(xml: bytes, fonte: dict, agora: datetime) -> list[dict]:
    """Itens válidos do feed. Sem título, link ou data válida, ou datado >1 h no futuro: descartado.

    Levanta ValueError se o XML estiver quebrado ou for recusado pelo defusedxml.
    """
    xml = xml.lstrip()  # G1 Economia manda linhas em branco antes do cabeçalho
    if fonte.get("encoding"):
        # feed sem declaração (UOL): decodifica pelo encoding da fonte e passa a UTF-8
        texto = xml.decode(fonte["encoding"], errors="replace")
        xml = _DECLARACAO_XML.sub(b"", texto.encode("utf-8"))
    try:
        raiz = ET.fromstring(xml)
    except ET.ParseError as e:
        raise ValueError(f"XML inválido: {e}") from e

    limite = agora + TOLERANCIA_FUTURO
    noticias = []
    for item in raiz.iter():
        if _tag(item) not in ("item", "entry"):
            continue
        titulo = _limpar(_texto(item, "title"))
        url = _link(item)
        publicado = next(
            (d for d in (_data(_texto(item, n)) for n in ("pubDate", "published", "date", "updated")) if d),
            None,
        )
        if len(titulo) > TITULO_MAX:
            titulo = _cortar(titulo, TITULO_MAX)
        if not titulo or not _url_valida(url) or publicado is None or publicado > limite:
            continue
        noticias.append({
            "titulo": titulo,
            "url": url,
            "publicado_em": publicado,
            "lide": extrair_lide(_texto(item, "description", "summary", "encoded", "content")),
            "fonte": fonte["nome"],
            "tema": fonte["tema"],
            "peso": fonte["peso"],
        })
    return noticias


def coletar_noticias(fontes: list[dict], baixar=baixar, agora: datetime | None = None) -> tuple[list[dict], list[str]]:
    """Baixa e lê todas as fontes. Falha de uma fonte não derruba as outras.

    Devolve (notícias, erros); cada erro começa pelo nome da fonte.
    """
    from coletor import redigir

    agora = agora or datetime.now(timezone.utc)
    noticias, erros = [], []
    for fonte in fontes:
        try:
            noticias += parse_feed(baixar(fonte["url"]), fonte, agora)
        except Exception as e:  # rede, HTTP 4xx/5xx ou XML ruim: registra e segue
            erros.append(f"{fonte['nome']}: {redigir(str(e))}")
    return noticias, erros
