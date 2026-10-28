import unittest
from datetime import datetime

import coletor as c


def linha(vals):
    return "<tr>" + "".join(f"<td>{v}</td>" for v in vals) + "</tr>"


FII_HTML = (
    "<table><thead><tr>"
    + "".join(f"<th>{h}</th>" for h in [
        "Papel", "Segmento", "Cotação", "FFO Yield", "Dividend Yield", "P/VP",
        "Valor de Mercado", "Liquidez", "Qtd de imóveis", "Preço do m2",
        "Aluguel por m2", "Cap Rate", "Vacância Média"])
    + "</tr></thead><tbody>"
    + linha(["FIIA11", "Papel", "8,92", "12,00%", "12,71%", "1,01", "4.000.000.000,00",
             "25.000.000,00", "0", "0,00", "0,00", "0,00%", "0,00%"])
    + linha(["FIIB11", "Logística", "74,63", "8,00%", "8,40%", "0,96", "2.000.000.000,00",
             "9.000.000,00", "20", "3.000,00", "20,00", "8,00%", "5,00%"])
    + "</tbody></table>"
)

ACAO_HTML = (
    "<table><tr><th>Papel</th><th>Cotação</th><th>P/L</th><th>P/VP</th><th>PSR</th>"
    "<th>Div.Yield</th></tr>"
    + linha(["ACAO4", "15,31", "9,45", "1,60", "0,00", "7,10%"])
    + "</table>"
)

YAHOO = {
    "chart": {"result": [{
        "meta": {"regularMarketPrice": 8.92, "regularMarketTime": 1761249600},
        "timestamp": [1, 2, 3, 4],
        "indicators": {"quote": [{
            "close": [8.4, None, 8.7, 8.92],
            "high": [8.5, None, 8.8, 8.95],
            "low": [8.3, None, 8.6, 8.7],
        }]},
        "events": {"dividends": {
            "a": {"amount": 0.10, "date": 1759000000},
            "b": {"amount": 0.09, "date": 1761000000},
        }},
    }]}
}

TESOURO_CSV = (
    "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;"
    "PU Compra Manha;PU Venda Manha;PU Base Manha\n"
    "Tesouro Prefixado;01/01/2032;22/10/2026;12,70;12,82;418,20;409,75;408,00\n"
    "Tesouro Prefixado;01/01/2032;23/10/2026;12,75;12,87;417,10;412,30;409,75\n"
    "Tesouro Selic;01/03/2031;23/10/2026;0,05;0,15;16.000,00;15.990,00;15.990,00\n"
)


class Testes(unittest.TestCase):
    def test_br_num(self):
        self.assertEqual(c.br_num("1.234,56"), 1234.56)
        self.assertEqual(c.br_num("12,71%"), 12.71)
        self.assertIsNone(c.br_num("-"))

    def test_fundamentus_fii(self):
        r = c.parse_fundamentus(FII_HTML, "fii")
        self.assertEqual(r["FIIA11"]["pvp"], 1.01)
        self.assertEqual(r["FIIB11"]["dy"], 8.4)
        self.assertEqual(r["FIIB11"]["cotacao"], 74.63)

    def test_fundamentus_acao(self):
        r = c.parse_fundamentus(ACAO_HTML, "acao")
        self.assertEqual(r["ACAO4"]["pl"], 9.45)
        self.assertEqual(r["ACAO4"]["pvp"], 1.6)

    def test_fundamentus_layout_quebrado(self):
        with self.assertRaises(ValueError):
            c.parse_fundamentus("<table><tr><td>nada</td></tr></table>", "fii")

    def test_yahoo(self):
        r = c.parse_yahoo(YAHOO)
        self.assertEqual(r["price"], 8.92)
        self.assertEqual(r["prev_close"], 8.7)  # penúltima barra válida
        self.assertEqual(r["low52"], 8.3)
        self.assertEqual(r["high52"], 8.95)
        self.assertEqual(r["ultimo_div"]["valor"], 0.09)

    def test_tesouro_pega_data_base_mais_recente(self):
        r = c.parse_tesouro(TESOURO_CSV, "Tesouro Prefixado", "01/01/2032")
        self.assertEqual(r["data_base"], "2026-10-23")
        self.assertEqual(r["taxa_venda"], 12.87)
        self.assertEqual(r["pu_venda"], 412.30)

    def test_tesouro_inexistente(self):
        with self.assertRaises(ValueError):
            c.parse_tesouro(TESOURO_CSV, "Tesouro IPCA+", "15/05/2035")

    def test_ipca_composto_nao_soma(self):
        self.assertAlmostEqual(c.composto([1.0] * 12), 12.68, places=2)

    def test_data_esperada(self):
        tz = c.TZ
        # segunda 10h25: pregão de hoje não fechou, esperado = sexta
        self.assertEqual(c.data_esperada(datetime(2026, 10, 26, 10, 25, tzinfo=tz)).isoformat(), "2026-10-23")
        # segunda 18h10: esperado = hoje
        self.assertEqual(c.data_esperada(datetime(2026, 10, 26, 18, 10, tzinfo=tz)).isoformat(), "2026-10-26")
        # domingo: esperado = sexta
        self.assertEqual(c.data_esperada(datetime(2026, 10, 25, 21, 30, tzinfo=tz)).isoformat(), "2026-10-23")
        # terça 13/10 10h: segunda 12/10 é feriado, esperado = sexta 09/10
        self.assertEqual(c.data_esperada(datetime(2026, 10, 13, 10, 0, tzinfo=tz)).isoformat(), "2026-10-09")
        # feriado 12/10 às 20h: sem pregão hoje, esperado = sexta 09/10
        self.assertEqual(c.data_esperada(datetime(2026, 10, 12, 20, 0, tzinfo=tz)).isoformat(), "2026-10-09")

    def test_montar_ativo_com_fontes_simuladas(self):
        antes = (c.brapi_quote, c.yahoo_chart)
        try:
            fresco = datetime(2026, 10, 23, 17, 0, tzinfo=c.TZ)
            c.brapi_quote = lambda t, tok: {"price": 8.92, "as_of": fresco, "prev_close": 8.70}
            c.yahoo_chart = lambda s, r="1y": c.parse_yahoo(YAHOO)
            fund = c.parse_fundamentus(FII_HTML, "fii")
            a = c.montar_ativo("FIIA11", "fii", fund, None, fresco.date())
        finally:
            c.brapi_quote, c.yahoo_chart = antes
        self.assertFalse(a["defasado"])
        self.assertEqual(a["vpa"], round(8.92 / 1.01, 2))
        self.assertEqual(a["pvp"], 1.01)
        self.assertEqual(a["dy_ultimo_x12_pct"], round(0.09 * 12 / 8.92 * 100, 2))
        self.assertFalse(a["verificacao"]["divergente"])


if __name__ == "__main__":
    unittest.main()
