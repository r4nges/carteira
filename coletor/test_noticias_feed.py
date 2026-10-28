import html
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from noticias import feed
from noticias.fontes import FONTES

AGORA = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
FONTE = {"nome": "Jornal A", "url": "https://a.example/feed", "tema": "economia",
         "peso": 0.8, "encoding": None}


def escapar(texto, niveis):
    for _ in range(niveis):
        texto = html.escape(texto, quote=False)
    return texto


def rss(*itens):
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>'
            + "".join(itens) + "</channel></rss>").encode()


def item(titulo="Título", link="https://a.example/1", data="Mon, 26 Oct 2026 10:00:00 GMT", desc="Resumo."):
    partes = []
    if titulo is not None:
        partes.append(f"<title>{titulo}</title>")
    if link is not None:
        partes.append(f"<link>{link}</link>")
    if data is not None:
        partes.append(f"<pubDate>{data}</pubDate>")
    partes.append(f"<description>{desc}</description>")
    return "<item>" + "".join(partes) + "</item>"


class TestesExtrairLide(unittest.TestCase):
    def test_extrair_lide_corta_em_fim_de_frase(self):
        frase = "Palavra " * 20 + "fim."  # 164 caracteres
        texto = " ".join([frase] * 3)
        self.assertGreater(len(texto), 450)
        lide = feed.extrair_lide(texto)
        self.assertTrue(lide.endswith("."))
        self.assertLessEqual(len(lide), 300)
        self.assertEqual(lide, frase)

    def test_junta_ate_tres_frases_que_cabem(self):
        texto = "Primeira frase. Segunda frase! Terceira frase? Quarta frase."
        self.assertEqual(feed.extrair_lide(texto, limite=50),
                         "Primeira frase. Segunda frase! Terceira frase?")

    def test_primeira_frase_longa_corta_em_palavra_com_reticencias(self):
        texto = "palavra " * 80 + "fim."
        lide = feed.extrair_lide(texto)
        self.assertTrue(lide.endswith("…"))
        self.assertLessEqual(len(lide), 300)
        self.assertTrue(lide[:-1].endswith("palavra"))

    def test_texto_curto_volta_igual(self):
        self.assertEqual(feed.extrair_lide("Selic mantida em 15%."), "Selic mantida em 15%.")

    def test_remove_html_espacos_e_entidades(self):
        bruto = "<p>Bolsa   sobe\n e  <b>dólar</b> cai &amp; juros ficam.</p><img src='x'/>"
        self.assertEqual(feed.extrair_lide(bruto), "Bolsa sobe e dólar cai & juros ficam.")


class TestesSaneamento(unittest.TestCase):
    def test_html_com_escape_duplo_nao_vaza_marcacao(self):
        casos = [
            "&amp;lt;p&amp;gt;Texto &amp;amp; mais&amp;lt;/p&amp;gt;",
            "&amp;lt;script&amp;gt;x()&amp;lt;/script&amp;gt;Texto &amp;amp; mais",
            "&lt;script&gt;x()&lt;/script&gt;Texto &amp; mais",
        ]
        for c in casos:
            with self.subTest(c=c):
                lide = feed.extrair_lide(c)
                self.assertNotRegex(lide, r"</?[A-Za-z]")
                self.assertNotIn("x()", lide)
                self.assertIn("Texto", lide)
        self.assertEqual(feed.extrair_lide(casos[0]), "Texto & mais")

    def test_escape_duplo_em_lide_e_titulo_via_parse_feed(self):
        xml = rss(item(titulo="&amp;lt;b&amp;gt;Dólar&amp;lt;/b&amp;gt; cai &amp;amp; Bolsa sobe",
                       desc="&amp;lt;p&amp;gt;Texto&amp;lt;/p&amp;gt;&amp;lt;script&amp;gt;x()&amp;lt;/script&amp;gt; &amp;amp; mais"))
        n = feed.parse_feed(xml, FONTE, AGORA)[0]
        self.assertEqual(n["titulo"], "Dólar cai & Bolsa sobe")
        self.assertEqual(n["lide"], "Texto & mais")

    def test_comparacao_em_texto_puro_perde_os_sinais_mas_mantem_o_texto(self):
        # troca consciente: o saneamento final remove todo < e >, então a comparação
        # em texto puro deixa de ser preservada (o texto em volta continua legível)
        self.assertEqual(feed.extrair_lide("a < b e c > d fim"), "a b e c d fim")
        self.assertEqual(feed.extrair_lide("a &lt; b e c &gt; d fim"), "a b e c d fim")

    def test_cinco_niveis_de_escape_nao_deixam_marcacao(self):
        for niveis in range(1, 8):
            with self.subTest(niveis=niveis, caso="p"):
                lide = feed.extrair_lide(escapar("<p>Texto <b>forte</b> &amp; mais</p>", niveis))
                self.assertNotIn("<", lide)
                self.assertNotIn(">", lide)
                self.assertEqual(lide, "Texto forte & mais")
            with self.subTest(niveis=niveis, caso="script"):
                lide = feed.extrair_lide(escapar("<script>roubar()</script>Texto <i>ok</i>", niveis))
                self.assertNotIn("<", lide)
                self.assertNotIn(">", lide)
                self.assertNotIn("roubar", lide)
                self.assertNotIn("script", lide.lower())
                self.assertEqual(lide, "Texto ok")

    def test_cinco_niveis_via_parse_feed_em_titulo_e_lide(self):
        xml = rss(item(titulo=escapar("<b>Dólar</b> cai", 6),
                       desc=escapar("<script>roubar()</script><p>Texto</p>", 6)))
        n = feed.parse_feed(xml, FONTE, AGORA)[0]
        self.assertEqual(n["titulo"], "Dólar cai")
        self.assertEqual(n["lide"], "Texto")

    def test_aninhamento_adversarial_termina_rapido_sem_marcacao(self):
        for texto in (escapar("<script>x()</script><p>Texto</p>", 50), escapar("<p>Texto</p>", 500)):
            inicio = time.monotonic()
            lide = feed.extrair_lide(texto)
            self.assertLess(time.monotonic() - inicio, 1.0)
            self.assertNotIn("<", lide)
            self.assertNotIn(">", lide)

    def test_item_com_url_malformada_nao_derruba_o_feed(self):
        xml = rss(item(titulo="Ruim", link="http://[abc"), item(titulo="Bom", link="https://a.example/ok"))
        r = feed.parse_feed(xml, FONTE, AGORA)
        self.assertEqual([n["titulo"] for n in r], ["Bom"])

    def test_url_so_http_ou_https(self):
        xml = rss(item(titulo="JS", link="javascript:alert(1)"), item(titulo="Data", link="data:text/html,x"),
                  item(titulo="Rel", link="/materia/1"), item(titulo="Ok", link="http://a.example/1"),
                  item(titulo="Seguro", link="HTTPS://a.example/2"))
        r = feed.parse_feed(xml, FONTE, AGORA)
        self.assertEqual([n["titulo"] for n in r], ["Ok", "Seguro"])

    def test_titulo_longo_e_cortado(self):
        r = feed.parse_feed(rss(item(titulo="palavra " * 100)), FONTE, AGORA)
        self.assertLessEqual(len(r[0]["titulo"]), 300)
        self.assertTrue(r[0]["titulo"].endswith("…"))
        r = feed.parse_feed(rss(item(titulo="Curto")), FONTE, AGORA)
        self.assertEqual(r[0]["titulo"], "Curto")


class TestesParseFeed(unittest.TestCase):
    def test_parse_feed_rss_e_atom(self):
        r = feed.parse_feed(rss(item()), FONTE, AGORA)
        self.assertEqual(len(r), 1)
        n = r[0]
        self.assertEqual(n["titulo"], "Título")
        self.assertEqual(n["url"], "https://a.example/1")
        self.assertEqual(n["publicado_em"], datetime(2026, 10, 26, 10, 0, tzinfo=timezone.utc))
        self.assertIsNotNone(n["publicado_em"].tzinfo)
        self.assertEqual(n["lide"], "Resumo.")
        self.assertEqual((n["fonte"], n["tema"], n["peso"]), ("Jornal A", "economia", 0.8))

        atom = (b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>'
                b'<entry><title>Atom &amp; cia</title>'
                b'<link rel="self" href="https://a.example/self"/>'
                b'<link rel="alternate" href="https://a.example/2"/>'
                b'<updated>2026-10-26T08:30:00-03:00</updated>'
                b'<summary type="html">&lt;p&gt;Texto do atom.&lt;/p&gt;</summary></entry></feed>')
        r = feed.parse_feed(atom, FONTE, AGORA)
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["titulo"], "Atom & cia")
        self.assertEqual(r[0]["url"], "https://a.example/2")
        self.assertEqual(r[0]["publicado_em"], datetime(2026, 10, 26, 11, 30, tzinfo=timezone.utc))
        self.assertEqual(r[0]["lide"], "Texto do atom.")

    def test_descarta_item_sem_titulo_sem_link_sem_data(self):
        xml = rss(item(titulo=None), item(link=None, titulo="B"), item(data=None, titulo="C"),
                  item(data="lixo", titulo="D"), item(titulo="Bom", link="https://a.example/ok"))
        r = feed.parse_feed(xml, FONTE, AGORA)
        self.assertEqual([n["titulo"] for n in r], ["Bom"])

    def test_data_mais_de_1h_no_futuro_descartada(self):
        futuro = (AGORA + timedelta(hours=2)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        quase = (AGORA + timedelta(minutes=30)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        xml = rss(item(titulo="Futuro", data=futuro), item(titulo="Quase", data=quase))
        r = feed.parse_feed(xml, FONTE, AGORA)
        self.assertEqual([n["titulo"] for n in r], ["Quase"])

    def test_xml_com_espaco_antes_do_cabecalho(self):
        r = feed.parse_feed(b"\n  \r\n" + rss(item()), FONTE, AGORA)
        self.assertEqual(len(r), 1)

    def test_encoding_iso_8859_1_sem_declaracao(self):
        xml = ('<rss version="2.0"><channel><title>x</title>'
               + item(titulo="Ação do dólar", desc="Inflação em queda.")
               + "</channel></rss>").encode("iso-8859-1")
        r = feed.parse_feed(xml, {**FONTE, "encoding": "iso-8859-1"}, AGORA)
        self.assertEqual(r[0]["titulo"], "Ação do dólar")
        self.assertEqual(r[0]["lide"], "Inflação em queda.")

    def test_encoding_iso_8859_1_com_declaracao(self):
        xml = ('<?xml version="1.0" encoding="iso-8859-1"?><rss version="2.0"><channel>'
               + item(titulo="Ação") + "</channel></rss>").encode("iso-8859-1")
        r = feed.parse_feed(xml, {**FONTE, "encoding": "iso-8859-1"}, AGORA)
        self.assertEqual(r[0]["titulo"], "Ação")

    def test_namespaces_ignorados(self):
        xml = (b'<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" '
               b'xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'
               b'<item><title>NS</title><link>https://a.example/ns</link>'
               b'<dc:date>2026-10-26T09:00:00Z</dc:date>'
               b'<content:encoded><![CDATA[<p>Corpo em html.</p>]]></content:encoded></item>'
               b'</channel></rss>')
        r = feed.parse_feed(xml, FONTE, AGORA)
        self.assertEqual(r[0]["lide"], "Corpo em html.")
        self.assertEqual(r[0]["publicado_em"], datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc))

    def test_xml_quebrado_levanta_valueerror(self):
        with self.assertRaises(ValueError):
            feed.parse_feed(b"<rss><channel><item></rss>", FONTE, AGORA)
        with self.assertRaises(ValueError):
            feed.parse_feed(b"pagina de erro, nao e xml", FONTE, AGORA)

    def test_xml_com_entidade_externa_e_recusado(self):
        xml = (b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
               b'<rss><channel><item><title>&x;</title></item></channel></rss>')
        with self.assertRaises(ValueError):
            feed.parse_feed(xml, FONTE, AGORA)

    def test_description_com_texto_completo_so_leva_abertura(self):
        longo = " ".join(f"Frase número {i} da matéria completa." for i in range(100))
        self.assertGreater(len(longo), 3000)
        r = feed.parse_feed(rss(item(desc=f"<![CDATA[<p>{longo}</p>]]>")), FONTE, AGORA)
        self.assertLessEqual(len(r[0]["lide"]), 300)
        self.assertTrue(r[0]["lide"].startswith("Frase número 0"))


class TestesColetar(unittest.TestCase):
    def test_coletar_noticias_isola_falhas(self):
        a = {**FONTE, "nome": "A", "url": "https://a.example/feed?token=segredo"}
        b = {**FONTE, "nome": "B", "url": "https://b.example/feed"}
        c = {**FONTE, "nome": "C", "url": "https://c.example/feed"}
        d = {**FONTE, "nome": "D", "url": "https://d.example/feed"}

        def baixar(url):
            if "b.example" in url:
                raise RuntimeError("HTTP 403 em b.example/feed")
            if "c.example" in url:
                raise RuntimeError("HTTP 404 em c.example/feed")
            if "d.example" in url:
                return b"<rss><quebrado"
            return rss(item())

        itens, erros = feed.coletar_noticias([a, b, c, d], baixar=baixar, agora=AGORA)
        self.assertEqual([n["fonte"] for n in itens], ["A"])
        self.assertEqual(len(erros), 3)
        self.assertTrue(erros[0].startswith("B") and "403" in erros[0])
        self.assertTrue(erros[1].startswith("C") and "404" in erros[1])
        self.assertTrue(erros[2].startswith("D"))
        self.assertNotIn("segredo", "".join(erros))

    def test_coletar_sem_falhas_devolve_erros_vazio(self):
        itens, erros = feed.coletar_noticias([FONTE], baixar=lambda u: rss(item()), agora=AGORA)
        self.assertEqual((len(itens), erros), (1, []))


class TestesBaixar(unittest.TestCase):
    def test_baixar_devolve_bytes_e_erro_sem_query_string(self):
        resp = mock.Mock(status_code=200, content=b"<rss/>")
        with mock.patch("coletor.requests.get", return_value=resp):
            self.assertEqual(feed.baixar("https://a.example/feed?token=segredo"), b"<rss/>")
        resp = mock.Mock(status_code=404, headers={})
        with mock.patch("coletor.requests.get", return_value=resp), mock.patch("coletor.time.sleep"):
            with self.assertRaises(RuntimeError) as cm:
                feed.baixar("https://a.example/feed?token=segredo")
        self.assertIn("HTTP 404", str(cm.exception))
        self.assertNotIn("segredo", str(cm.exception))


class TestesFontes(unittest.TestCase):
    def test_fontes_bem_formadas(self):
        self.assertGreaterEqual(len(FONTES), 20)
        nomes = [f["nome"] for f in FONTES]
        self.assertEqual(len(nomes), len(set(nomes)))
        for f in FONTES:
            self.assertEqual(set(f), {"nome", "url", "tema", "peso", "encoding"})
            self.assertIn(f["tema"], ("politica", "economia", "mundo"))
            self.assertTrue(f["url"].startswith("https://"))
            self.assertIsInstance(f["peso"], float)
        uol = next(f for f in FONTES if f["nome"] == "UOL Economia")
        self.assertEqual(uol["encoding"], "iso-8859-1")
        urls = {f["url"] for f in FONTES}
        self.assertIn("https://pox.globo.com/rss/valor", urls)
        self.assertIn("https://www.cnnbrasil.com.br/feed/", urls)
        self.assertIn("https://oglobo.globo.com/rss/oglobo/politica", urls)


if __name__ == "__main__":
    unittest.main()
