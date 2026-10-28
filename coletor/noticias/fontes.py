"""Fontes de notícias (feeds RSS/Atom públicos de veículos e órgãos oficiais).

Cada fonte: nome do veículo, url do feed, tema, peso (0 a 1, usado no ranking
das notícias) e encoding (só quando o feed não declara e não é UTF-8).
"""
from __future__ import annotations


def _f(nome, url, tema, peso, encoding=None):
    return {"nome": nome, "url": url, "tema": tema, "peso": peso, "encoding": encoding}


FONTES: list[dict] = [
    _f("G1 Política", "https://g1.globo.com/rss/g1/politica/", "politica", 0.8),
    _f("G1 Economia", "https://g1.globo.com/rss/g1/economia/", "economia", 0.8),
    _f("G1 Mundo", "https://g1.globo.com/rss/g1/mundo/", "mundo", 0.7),
    _f("O Globo Política", "https://oglobo.globo.com/rss/oglobo/politica", "politica", 0.8),
    _f("O Globo Economia", "https://oglobo.globo.com/rss/oglobo/economia", "economia", 0.8),
    _f("Folha Poder", "https://feeds.folha.uol.com.br/poder/rss091.xml", "politica", 0.8),
    _f("Folha Mercado", "https://feeds.folha.uol.com.br/mercado/rss091.xml", "economia", 0.8),
    _f("Estadão Política", "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/", "politica", 0.8),
    _f("Estadão Economia", "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/", "economia", 0.8),
    _f("Valor", "https://pox.globo.com/rss/valor", "economia", 0.9),
    _f("InfoMoney", "https://www.infomoney.com.br/feed/", "economia", 0.7),
    _f("Money Times", "https://www.moneytimes.com.br/feed/", "economia", 0.6),
    _f("Exame", "https://exame.com/feed/", "economia", 0.6),
    _f("Agência Brasil Política", "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", "politica", 0.7),
    _f("Agência Brasil Economia", "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml", "economia", 0.7),
    _f("Agência Câmara", "https://www.camara.leg.br/noticias/rss/ultimas-noticias", "politica", 0.6),
    _f("Agência Senado", "https://www12.senado.leg.br/noticias/rss", "politica", 0.6),
    _f("Poder360", "https://www.poder360.com.br/feed/", "politica", 0.7),
    _f("BBC Brasil", "https://feeds.bbci.co.uk/portuguese/rss.xml", "mundo", 0.7),
    _f("CNN Brasil", "https://www.cnnbrasil.com.br/feed/", "mundo", 0.6),
    _f("UOL Economia", "https://rss.uol.com.br/feed/economia.xml", "economia", 0.6, "iso-8859-1"),
    _f("CVM", "https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS", "economia", 1.0),
    _f("BCB", "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias", "economia", 1.0),
]
