#!/usr/bin/env python3
"""Coletor de dados de mercado da Carteira do Rangel.

Lê a lista de ativos do banco (Supabase) e grava ali cotações, índices, macro,
Tesouro e o snapshot diário do patrimônio. Cada dado leva horário e fonte.

Uso:
    python coletor.py --modo pregao       # cotações e índices (só em dia de pregão)
    python coletor.py --modo fechamento   # pregao + Fundamentus, macro, Tesouro e snapshot
    python coletor.py --modo noticias     # feeds de notícias (todo dia, sem depender do pregão)
    python coletor.py --modo pregao --config outro.json

Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_KEY e o token da brapi
(nome em brapi_token_env no config; padrão BRAPI_TOKEN).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import requests

from calendario import eh_pregao, ultimo_pregao_ate
from db import Banco
from noticias.briefing import texto_mercado
from noticias.classificar import agrupar, marcar_ativos, pontuar, tags_macro
from noticias.feed import baixar as baixar_feed, coletar_noticias
from noticias.fontes import FONTES as FONTES_NOTICIAS

TZ = timezone(timedelta(hours=-3))  # America/Sao_Paulo
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

TESOURO_CSV = (
    "https://www.tesourotransparente.gov.br/ckan/dataset/"
    "df56aa42-484a-4a59-8184-7676580c81e3/resource/"
    "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv"
)


# ---------------------------------------------------------------- utilidades
PAUSA_BRAPI = 1.1  # plano grátis da brapi: 1 requisição simultânea, 1 ticker por chamada
RETRY_AFTER_MAX = 60
RETRY_AFTER_PADRAO = 5
_ultima_brapi = None  # time.monotonic() do fim da última chamada à brapi

_SEGREDOS = (
    (re.compile(r"(?i)((?:token|apikey|api_key)=)[^&\s]*"), r"\g<1>***"),
    (re.compile(r"""(?i)(Bearer\s+)[^\s,;"']+"""), r"\g<1>***"),
)


def redigir(texto: str) -> str:
    """Troca valores de token=, apikey=, api_key= e Bearer por '***'."""
    for rx, sub in _SEGREDOS:
        texto = rx.sub(sub, texto)
    return texto


def _retry_after(r) -> int:
    try:
        v = int(str(r.headers.get("Retry-After", "")).strip())
    except (ValueError, AttributeError):
        return RETRY_AFTER_PADRAO
    return min(max(v, 0), RETRY_AFTER_MAX)


def get(url, *, params=None, headers=None, timeout=30, retries=2):
    """GET com retry. Erros levantados nunca trazem query string nem cabeçalhos."""
    h = {"User-Agent": UA, **(headers or {})}
    p = urlsplit(url)
    onde = f"{p.hostname or p.netloc}{p.path}"
    ultimo = None
    for i in range(retries + 1):
        espera = 1.5 * (i + 1)
        try:
            r = requests.get(url, params=params, headers=h, timeout=timeout)
        except requests.RequestException as e:
            ultimo = RuntimeError(f"{type(e).__name__} em {onde}")
        else:
            if r.status_code < 400:
                return r
            ultimo = RuntimeError(f"HTTP {r.status_code} em {onde}")
            if r.status_code == 429:
                espera = _retry_after(r)
        if i == retries:
            break  # sem nova tentativa: não adianta esperar
        time.sleep(espera)
    raise ultimo


def br_num(s):
    """'1.234,56' -> 1234.56 ; '12,5%' -> 12.5 ; '-' ou vazio -> None."""
    if s is None:
        return None
    s = str(s).replace("%", "").replace("R$", "").strip()
    if s in ("", "-"):
        return None
    return float(s.replace(".", "").replace(",", "."))


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return s.strip().lower()


def to_dt(v):
    """Epoch (s) ou ISO -> datetime com fuso de Brasília."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, TZ)
    d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=TZ)
    return d.astimezone(TZ)


def iso(d):
    return d.isoformat(timespec="seconds") if d else None


def data_esperada(now: datetime) -> date:
    """Data do último pregão da B3 que já deveria ter fechado (fecha às 18h)."""
    d = now.date()
    if eh_pregao(d) and now.hour < 18:
        d -= timedelta(days=1)
    return ultimo_pregao_ate(d)


def composto(variacoes_pct):
    p = 1.0
    for v in variacoes_pct:
        p *= 1 + v / 100
    return (p - 1) * 100


# ---------------------------------------------------------------- Fundamentus
class _Tabela(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self._row, self._cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


_COLUNAS = {
    "fii": {"cotacao": 2, "dy": 4, "pvp": 5, "liquidez": 7},
    "acao": {"cotacao": 1, "pl": 2, "pvp": 3, "dy": 5},
}


def parse_fundamentus(html: str, kind: str) -> dict:
    """Colunas por posição, como recomenda a documentação do formato; valida o cabeçalho."""
    t = _Tabela()
    t.feed(html)
    cols = _COLUNAS[kind]
    cab = next((r for r in t.rows if r and norm(r[0]) == "papel"), None)
    if cab is None or len(cab) <= cols["pvp"] or norm(cab[cols["pvp"]]) != "p/vp":
        raise ValueError("layout do Fundamentus mudou (cabeçalho P/VP não encontrado)")
    out = {}
    for r in t.rows:
        if r and re.fullmatch(r"[A-Z]{4}\d{1,2}", r[0]):
            out[r[0]] = {k: br_num(r[i]) for k, i in cols.items() if i < len(r)}
    return out


def fundamentus(kind: str) -> dict:
    url = {
        "fii": "https://www.fundamentus.com.br/fii_resultado.php",
        "acao": "https://www.fundamentus.com.br/resultado.php",
    }[kind]
    r = get(url)
    return parse_fundamentus(r.content.decode("iso-8859-1"), kind)


# ---------------------------------------------------------------- cotações
def brapi_quote(ticker: str, token: str | None) -> dict:
    global _ultima_brapi
    if _ultima_brapi is not None:
        falta = PAUSA_BRAPI - (time.monotonic() - _ultima_brapi)
        if falta > 0:
            time.sleep(falta)
    try:
        r = get(
            f"https://brapi.dev/api/quote/{ticker}",
            headers={"Authorization": f"Bearer {token}"} if token else None,
        )
    finally:
        _ultima_brapi = time.monotonic()
    d = r.json()["results"][0]
    return {
        "price": d["regularMarketPrice"],
        "as_of": to_dt(d.get("regularMarketTime")),
        "prev_close": d.get("regularMarketPreviousClose"),
    }


def parse_yahoo(j: dict) -> dict:
    res = j["chart"]["result"][0]
    meta = res["meta"]
    q = res["indicators"]["quote"][0]
    barras = [
        (c, h, l)
        for c, h, l in zip(q["close"], q["high"], q["low"])
        if c is not None and h is not None and l is not None
    ]
    divs = (res.get("events") or {}).get("dividends") or {}
    lista = sorted(
        ((datetime.fromtimestamp(v["date"], TZ).date(), v["amount"]) for v in divs.values()),
        key=lambda x: x[0],
    )
    corte = datetime.now(TZ).date() - timedelta(days=365)
    return {
        "price": meta["regularMarketPrice"],
        "as_of": to_dt(meta.get("regularMarketTime")),
        "prev_close": barras[-2][0] if len(barras) >= 2 else None,
        "low52": min(b[2] for b in barras) if barras else None,
        "high52": max(b[1] for b in barras) if barras else None,
        "ultimo_div": {"valor": lista[-1][1], "data": lista[-1][0].isoformat()} if lista else None,
        "div_12m": round(sum(a for d, a in lista if d >= corte), 4) if lista else None,
    }


def yahoo_chart(symbol: str, rng: str = "1y") -> dict:
    r = get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
        params={"range": rng, "interval": "1d", "events": "div"},
    )
    return parse_yahoo(r.json())


# ---------------------------------------------------------------- Banco Central
def sgs(codigo: int, n: int) -> list[dict]:
    r = get(
        f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados/ultimos/{n}",
        params={"formato": "json"},
    )
    return [
        {"data": datetime.strptime(x["data"], "%d/%m/%Y").date(), "valor": float(x["valor"])}
        for x in r.json()
    ]


def focus_anual(indicador: str, ano: int):
    url = "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais"
    # O Olinda não decodifica "+" como espaço (400 em $filter e $orderby): espaço vai como %20.
    params = urlencode(
        {
            "$top": 1,
            "$filter": f"Indicador eq '{indicador}' and DataReferencia eq '{ano}' and baseCalculo eq 0",
            "$orderby": "Data desc",
            "$select": "Indicador,Data,DataReferencia,Mediana",
            "$format": "json",
        },
        quote_via=quote,
        safe="$',()",
    )
    r = get(url, params=params)
    v = r.json().get("value") or []
    return {"data": v[0]["Data"], "mediana": v[0]["Mediana"]} if v else None


# ---------------------------------------------------------------- Tesouro
def baixar_tesouro(url: str) -> str:
    r = get(url, timeout=120)
    return r.content.decode("utf-8-sig", errors="replace")


def parse_tesouro(texto: str, tipo: str, vencimento: str) -> dict:
    rd = csv.DictReader(io.StringIO(texto), delimiter=";")
    rd.fieldnames = [norm(c) for c in rd.fieldnames]
    melhor = None
    for row in rd:
        if norm(row["tipo titulo"]) == norm(tipo) and row["data vencimento"].strip() == vencimento:
            d = datetime.strptime(row["data base"].strip(), "%d/%m/%Y").date()
            if melhor is None or d > melhor[0]:
                melhor = (d, row)
    if melhor is None:
        raise ValueError(f"título não encontrado: {tipo} {vencimento}")
    d, row = melhor
    return {
        "data_base": d.isoformat(),
        "taxa_compra": br_num(row.get("taxa compra manha")),
        "taxa_venda": br_num(row.get("taxa venda manha")),
        "pu_compra": br_num(row.get("pu compra manha")),
        "pu_venda": br_num(row.get("pu venda manha")),
    }


# ---------------------------------------------------------------- montagem
def montar_ativo(ticker, tipo, fund, token, esperada):
    avisos, cands = [], []
    try:
        cands.append(("brapi", brapi_quote(ticker, token)))
    except Exception as e:  # noqa: BLE001
        avisos.append(redigir(f"brapi: {e}"))
    y = None
    try:
        y = yahoo_chart(f"{ticker}.SA")
        cands.append(("yahoo", y))
    except Exception as e:  # noqa: BLE001
        avisos.append(redigir(f"yahoo: {e}"))
    if not cands:
        raise RuntimeError(redigir("; ".join(avisos)))

    # fica com a cotação de horário mais recente; empate favorece a primeira da lista
    fonte, c = max(cands, key=lambda x: x[1]["as_of"] or datetime.min.replace(tzinfo=TZ))
    preco = c["price"]
    a = {
        "tipo": tipo.upper(),
        "preco": preco,
        "preco_fonte": fonte,
        "as_of": iso(c["as_of"]),
        "defasado": bool(c["as_of"] and c["as_of"].date() < esperada),
        "variacao_dia_pct": round((preco / c["prev_close"] - 1) * 100, 2) if c.get("prev_close") else None,
        "prev_close": c.get("prev_close"),
    }
    if len(cands) == 2:
        p1, p2 = cands[0][1]["price"], cands[1][1]["price"]
        a["verificacao"] = {
            "brapi_x_yahoo_pct": round((p1 / p2 - 1) * 100, 2),
            "divergente": abs(p1 / p2 - 1) > 0.03,
        }
    if y:
        lo, hi = y["low52"], y["high52"]
        if lo is not None and hi is not None:
            lo, hi = min(lo, preco), max(hi, preco)
            a["faixa52"] = [round(lo, 2), round(hi, 2)]
            a["posicao_faixa52_pct"] = round((preco - lo) / (hi - lo) * 100, 1) if hi > lo else None
        if y["ultimo_div"]:
            a["ultimo_rendimento"] = y["ultimo_div"]
            if tipo == "fii":
                a["dy_ultimo_x12_pct"] = round(y["ultimo_div"]["valor"] * 12 / preco * 100, 2)
        if y["div_12m"] is not None:
            a["proventos_12m"] = y["div_12m"]
            a["dy_12m_calc_pct"] = round(y["div_12m"] / preco * 100, 2)
    f = (fund or {}).get(ticker)
    if f:
        # VPA vem do par (cotação, P/VP) do próprio Fundamentus; o P/VP atual usa o nosso preço
        if f.get("pvp") and f.get("cotacao"):
            vpa = f["cotacao"] / f["pvp"]
            a["vpa"] = round(vpa, 2)
            a["pvp"] = round(preco / vpa, 2)
            a["pvp_fundamentus"] = f["pvp"]
        a["dy_12m_fundamentus_pct"] = f.get("dy")
        if f.get("pl") is not None:
            a["pl"] = f["pl"]
    if avisos:
        a["avisos"] = avisos
    return a


# ---------------------------------------------------------------- coleta por modo
TIPO_KIND = {"FII": "fii", "Ação": "acao", "ETF": "acao", "BDR": "acao"}
TESOURO_DIRETO = "Tesouro Direto"
MODOS = ("pregao", "fechamento", "noticias")
SEM_GRAVACAO = "nada gravado: havia ativos a coletar e nenhum foi salvo"
SEM_NOTICIAS = "nada gravado: todas as fontes de notícias falharam"
SEM_NOTICIAS_SALVAS = "nada gravado: havia notícias lidas e nenhuma foi salva"
DIAS_NOTICIAS = 7  # notícias mais antigas que isso saem do banco

# Só entram na linha quando montar_ativo os devolve. Chave ausente no upsert
# mantém o valor guardado (ex.: P/VP do último fechamento durante o pregão).
_OPCIONAIS = ("posicao_faixa52_pct", "ultimo_rendimento", "proventos_12m", "pvp", "vpa", "pl")


def _agora() -> datetime:
    return datetime.now(TZ)


def _bloco(erros: list[str], nome: str, fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        erros.append(redigir(f"{nome}: {e}"))
        return None


def linha_cotacao(codigo: str, a: dict, quando: str) -> dict:
    """Saída de montar_ativo no formato da tabela `cotacoes`."""
    linha = {
        "codigo": codigo,
        "preco": a["preco"],
        "preco_fonte": a["preco_fonte"],
        "as_of": a["as_of"],
        "defasado": a["defasado"],
        "variacao_dia_pct": a["variacao_dia_pct"],
        "prev_close": a.get("prev_close"),
        # sempre presentes, para não deixar aviso ou verificação antigos no banco
        "verificacao": a.get("verificacao"),
        "avisos": a.get("avisos"),
        "erro": None,
        "atualizado_em": quando,
    }
    if "faixa52" in a:
        linha["faixa52_min"], linha["faixa52_max"] = a["faixa52"]
    dy = a.get("dy_12m_fundamentus_pct")
    if dy is None:
        dy = a.get("dy_12m_calc_pct")
    if dy is not None:
        linha["dy_12m_pct"] = dy
    for k in _OPCIONAIS:
        if k in a:
            linha[k] = a[k]
    return linha


def coletar_cotacoes(ativos: list[dict], fund: dict, token: str | None, esperada: date) -> list[dict]:
    """Uma linha por ativo negociado em bolsa.

    Falha devolve só codigo, erro, atualizado_em e defasado=True: o preço anterior
    fica no banco, mas o app não o mostra como fresco.
    """
    quando = iso(datetime.now(TZ))
    linhas = []
    for at in ativos:
        kind = TIPO_KIND.get(at.get("tipo"))
        if not kind:
            continue
        codigo = at["codigo"]
        try:
            a = montar_ativo(codigo, kind, fund, token, esperada)
        except Exception as e:  # noqa: BLE001
            linhas.append({"codigo": codigo, "erro": redigir(str(e) or type(e).__name__),
                           "atualizado_em": quando, "defasado": True})
        else:
            linhas.append(linha_cotacao(codigo, a, quando))
    return linhas


def coletar_indices(cfg: dict, esperada: date, erros: list[str] | None = None) -> dict:
    erros = [] if erros is None else erros
    out = {}
    for nome, simbolo in cfg.get("indices_yahoo", {}).items():
        def _idx(simbolo=simbolo):
            y = yahoo_chart(simbolo, "5d")
            return {
                "valor": y["price"],
                "variacao_dia_pct": round((y["price"] / y["prev_close"] - 1) * 100, 2) if y["prev_close"] else None,
                "as_of": iso(y["as_of"]),
                "defasado": bool(y["as_of"] and y["as_of"].date() < esperada),
                "fonte": "yahoo",
            }
        r = _bloco(erros, f"indice {nome}", _idx)
        if r:
            out[nome] = r
    return out


def coletar_macro(now: datetime, erros: list[str] | None = None) -> dict:
    erros = [] if erros is None else erros

    def _bcb():
        m = {}
        s = sgs(432, 1)[-1]
        m["selic_meta"] = {"valor": s["valor"], "data": s["data"].isoformat(), "fonte": "BCB SGS 432"}
        ip = sgs(433, 12)
        m["ipca_mes"] = {"valor": ip[-1]["valor"], "ref": ip[-1]["data"].isoformat(), "fonte": "BCB SGS 433"}
        m["ipca_12m"] = {
            "valor": round(composto([x["valor"] for x in ip]), 2),
            "ate": ip[-1]["data"].isoformat(),
            "fonte": "composto de BCB SGS 433",
        }
        d = sgs(1, 1)[-1]
        m["dolar_venda"] = {"valor": d["valor"], "data": d["data"].isoformat(), "fonte": "BCB SGS 1"}
        return m

    def _focus():
        res = {}
        for ano in (now.year, now.year + 1):
            for ind in ("IPCA", "Selic", "Câmbio"):
                r = focus_anual(ind, ano)
                if r:
                    res[f"{ind}_{ano}"] = r
        return res

    macro = _bloco(erros, "macro_bcb", _bcb) or {}
    focus = _bloco(erros, "focus", _focus)
    if focus:
        macro["focus"] = focus
    return macro


def _titulos(ativos: list[dict]) -> list[dict]:
    return [a for a in ativos
            if a.get("tipo") == TESOURO_DIRETO and a.get("tesouro_tipo") and a.get("vencimento")]


def coletar_tesouro(ativos: list[dict], cfg: dict, erros: list[str] | None = None) -> list[dict]:
    """Linhas da tabela `tesouro`, uma por título da carteira, com o CSV baixado uma vez."""
    erros = [] if erros is None else erros
    titulos = _titulos(ativos)
    if not titulos:
        return []
    texto = baixar_tesouro(cfg.get("tesouro_csv_url") or TESOURO_CSV)
    quando = iso(datetime.now(TZ))
    linhas, falhas = [], []
    for a in titulos:
        try:
            r = parse_tesouro(texto, a["tesouro_tipo"], a["vencimento"])
        except Exception as e:  # noqa: BLE001
            falhas.append(type(e).__name__)  # a mensagem cita o título: não vai para o log
            continue
        linhas.append({"codigo": a["codigo"], **r, "atualizado_em": quando})
    if falhas:
        erros.append(f"tesouro: {len(falhas)} de {len(titulos)} títulos falharam ({', '.join(sorted(set(falhas)))})")
    return linhas


def montar_snapshot(ativos: list[dict], cotacoes: dict[str, dict], tesouros: dict[str, dict],
                    data: date, erros: list[str] | None = None) -> dict | None:
    """Patrimônio do dia. None se algum ativo de bolsa não tem cotação de `data`
    ou se alguma posição fica sem valor. Título do Tesouro sem preço no CSV usa o
    valor da planilha e acrescenta um aviso (sem título) a `erros`."""
    erros = [] if erros is None else erros
    posicoes, total, estimados = {}, 0.0, 0
    for a in ativos:
        codigo, tipo = a["codigo"], a.get("tipo")
        qtd = float(a.get("quantidade") or 0)
        if tipo in TIPO_KIND:
            cot = cotacoes.get(codigo) or {}
            if cot.get("preco") is None or not cot.get("as_of") or to_dt(cot["as_of"]).date() != data:
                return None
            valor = qtd * float(cot["preco"])
        elif tipo == TESOURO_DIRETO and (tesouros.get(codigo) or {}).get("pu_venda") is not None:
            valor = qtd * float(tesouros[codigo]["pu_venda"])
        elif a.get("valor_atualizado") is None:  # sem preço e sem valor: não vale contar 0
            return None
        else:  # renda fixa, ou título sem preço do Tesouro: último valor importado
            valor = float(a["valor_atualizado"])
            estimados += tipo == TESOURO_DIRETO
        total += valor
        posicoes[codigo] = round(valor, 2)
    if estimados:
        erros.append(f"snapshot: {estimados} posições do Tesouro estimadas pelo valor da planilha")
    return {"data": data.isoformat(), "patrimonio": round(total, 2), "posicoes": posicoes}


def linha_noticia(item: dict) -> dict:
    """Notícia classificada no formato da tabela `noticias` (só as colunas dela, JSON puro).

    O id é o hash da URL: estável entre execuções. `grupo_id` sai do título do
    representante e muda se outra fonte passar a representar o grupo, então não serve de chave.
    """
    return {
        "id": hashlib.sha1(item["url"].encode("utf-8")).hexdigest()[:16],
        "titulo": item["titulo"],
        "lide": item["lide"],
        "fonte": item["fonte"],
        "tema": item["tema"],
        "url": item["url"],
        "publicado_em": item["publicado_em"].isoformat(timespec="seconds"),
        "ativos": item["ativos"],
        "tags": item["tags"],
        "grupo_id": item["grupo_id"],
        "tambem_em": item["tambem_em"],
        "score": round(item["score"], 4),
    }


def _sem_url_repetida(itens: list[dict]) -> list[dict]:
    """Uma notícia por URL (a de maior peso; empate, a mais antiga), na ordem da primeira aparição.

    `agrupar` só junta fontes diferentes: o mesmo item duas vezes no feed, ou a mesma
    URL em dois feeds, chegaria ao banco com o mesmo `id`.
    """
    melhor: dict[str, dict] = {}
    for it in itens:
        atual = melhor.get(it["url"])
        if atual is None or (-it["peso"], it["publicado_em"]) < (-atual["peso"], atual["publicado_em"]):
            melhor[it["url"]] = it
    return list(melhor.values())


def processar_noticias(itens: list[dict], ativos: list[dict], agora: datetime) -> list[dict]:
    """Descarta o que passou da janela e repete URL, agrupa, marca ativos e tags, pontua.

    Devolve as linhas da tabela por score decrescente, com `id` único no lote (um
    UPSERT com a mesma chave duas vezes é recusado pelo Postgres e perderia tudo).
    Notícia mais velha que a janela do banco (7 dias) nem entra: `limpar_noticias`
    filtra por `coletado_em`, que o upsert não renova, e o item ficaria apagando e regravando.
    """
    recentes = [it for it in itens if it["publicado_em"] >= agora - timedelta(days=DIAS_NOTICIAS)]
    classificados = []
    for it in agrupar(_sem_url_repetida(recentes)):
        it = {**it, "ativos": marcar_ativos(it, ativos), "tags": tags_macro(it)}  # antes de pontuar
        it["score"] = pontuar(it, agora)
        classificados.append(it)
    classificados.sort(key=lambda it: (-it["score"], -it["publicado_em"].timestamp(), it["url"]))
    linhas = {}
    for it in classificados:  # rede de segurança: já ordenado, o primeiro de cada id é o de maior score
        linha = linha_noticia(it)
        linhas.setdefault(linha["id"], linha)
    return list(linhas.values())


def _gravar_briefing(banco: Banco, indices: dict, cotacoes: list[dict], ativos: list[dict],
                     agora: datetime, erros: list[str]) -> None:
    """Grava o texto do bloco Mercado do app em `indicadores.briefing_mercado`.

    Grava mesmo vazio: sem dado nenhum nesta rodada, o texto de uma rodada anterior
    seria mostrado como se fosse de agora (ele não carrega aviso de defasagem), e o
    app esconde o bloco quando o texto vem vazio. Esconder só omite; manter mostraria
    número velho sem aviso. A falha do briefing não afeta o resto (ver _bloco).
    """
    texto = texto_mercado(indices, cotacoes, ativos)
    _bloco(erros, "salvar_briefing",
           lambda: banco.salvar_indicador("briefing_mercado", {"texto": texto, "as_of": iso(agora)}))


def executar_noticias(banco: Banco, agora: datetime) -> list[str]:
    """Baixa as fontes, classifica e grava. Roda todo dia: notícia não depende de pregão.

    Os erros citam o veículo (que é público) e nunca os ativos. Erro de execução
    (a main sai com 1): todas as fontes falharam (SEM_NOTICIAS) ou houve notícias
    mas nenhuma foi salva (SEM_NOTICIAS_SALVAS). Fonte quieta, sem item novo, não é erro.
    """
    ativos = banco.ativos()  # banco fora do ar: a exceção sobe para main
    itens, erros = coletar_noticias(FONTES_NOTICIAS, baixar=baixar_feed, agora=agora)
    falhas = len(erros)
    linhas = processar_noticias(itens, ativos, agora) if itens else []
    salvou = bool(linhas) and _bloco(erros, "salvar_noticias", lambda: banco.salvar_noticias(linhas) or True)
    _bloco(erros, "limpar_noticias", lambda: banco.limpar_noticias(DIAS_NOTICIAS))
    if falhas == len(FONTES_NOTICIAS):
        erros.append(SEM_NOTICIAS)
    elif linhas and not salvou:
        erros.append(SEM_NOTICIAS_SALVAS)
    print(f"noticias: {len(linhas) if salvou else 0} notícias gravadas "
          f"({len(itens)} lidas), {falhas} de {len(FONTES_NOTICIAS)} fontes com erro")
    return erros


def executar(modo: str, banco: Banco, cfg: dict, agora: datetime) -> list[str]:
    """Roda um modo e devolve a lista de erros.

    Os erros vão para o log público do agendador: não citam tickers nem títulos
    (a carteira não pode aparecer em lugar público); o detalhe por ativo fica na
    coluna `erro` de `cotacoes`, no banco.
    """
    if modo == "noticias":
        return executar_noticias(banco, agora)
    if modo not in MODOS:
        return [f"modo desconhecido: {modo}"]
    if not eh_pregao(agora.date()):
        print(f"{modo}: {agora.date().isoformat()} não é dia de pregão; nada a fazer")
        return []

    erros: list[str] = []
    esperada = data_esperada(agora)
    token = os.environ.get(cfg.get("brapi_token_env", "BRAPI_TOKEN")) or None
    ativos = banco.ativos()  # banco fora do ar: a exceção sobe para main
    bolsa = [a for a in ativos if a.get("tipo") in TIPO_KIND]
    fechamento = modo == "fechamento"

    fund: dict = {}
    if fechamento:
        for kind in sorted({TIPO_KIND[a["tipo"]] for a in bolsa}):
            fund.update(_bloco(erros, f"fundamentus_{kind}", lambda kind=kind: fundamentus(kind)) or {})

    linhas = coletar_cotacoes(bolsa, fund, token, esperada)
    ok = [linha for linha in linhas if "preco" in linha]
    if len(ok) < len(linhas):
        erros.append(f"cotacoes: {len(linhas) - len(ok)} de {len(linhas)} ativos falharam (detalhe na coluna erro)")
    salvou = bool(linhas) and _bloco(erros, "salvar_cotacoes", lambda: banco.salvar_cotacoes(linhas) or True)
    a_coletar, gravados = len(bolsa), (len(ok) if salvou else 0)

    indices = coletar_indices(cfg, esperada, erros)
    if indices:
        _bloco(erros, "salvar_indices", lambda: banco.salvar_indicador("indices", indices))

    _bloco(erros, "briefing", lambda: _gravar_briefing(banco, indices, linhas, ativos, agora, erros))

    resumo = (f"{modo}: {gravados}/{len(bolsa)} cotações gravadas "
              f"({sum(1 for linha in ok if linha['defasado'])} defasadas), {len(indices)} índices")

    if fechamento:
        macro = coletar_macro(agora, erros)
        if macro:
            _bloco(erros, "salvar_macro", lambda: banco.salvar_indicador("macro", macro))

        tes = _bloco(erros, "tesouro", lambda: coletar_tesouro(ativos, cfg, erros)) or []
        a_coletar += len(_titulos(ativos))
        if tes and _bloco(erros, "salvar_tesouro", lambda: banco.salvar_tesouro(tes) or True):
            gravados += len(tes)

        snap = montar_snapshot(ativos, {linha["codigo"]: linha for linha in linhas},
                               {t["codigo"]: t for t in tes}, esperada, erros)
        if snap is None:
            erros.append(f"snapshot: não gravado; falta cotação de {esperada.isoformat()} ou valor de alguma posição")
        else:
            _bloco(erros, "salvar_snapshot", lambda: banco.salvar_snapshot(snap))
        resumo += f", {len(tes)} títulos do Tesouro, snapshot {'gravado' if snap else 'não gravado'}"

    if a_coletar and not gravados:
        erros.append(SEM_GRAVACAO)
    print(resumo)
    return erros


def _config_padrao() -> Path:
    p = Path(__file__).with_name("config.json")
    return p if p.exists() else p.with_name("config.example.json")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modo", required=True, choices=MODOS)
    ap.add_argument("--config", default=None,
                    help="padrão: config.json ao lado do script, se existir; senão config.example.json")
    args = ap.parse_args(argv)

    try:
        cfg = json.loads(Path(args.config or _config_padrao()).read_text(encoding="utf-8"))
        banco = Banco.do_ambiente()
        erros = executar(args.modo, banco, cfg, _agora())
    except Exception as e:  # noqa: BLE001
        print(redigir(f"ERRO: {type(e).__name__}: {e}"), file=sys.stderr)
        return 1
    for e in erros:
        print("ERRO:", redigir(str(e)), file=sys.stderr)
    return 1 if any(m in erros for m in (SEM_GRAVACAO, SEM_NOTICIAS, SEM_NOTICIAS_SALVAS)) else 0


if __name__ == "__main__":
    sys.exit(main())
