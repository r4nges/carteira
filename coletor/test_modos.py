import contextlib
import io
import json
import os
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock

import requests

import coletor as c
from db import Banco
from test_coletor import ACAO_HTML, FII_HTML, TESOURO_CSV

SEGREDO = "SEGREDO123"
CONFIG_EXEMPLO = str(Path(__file__).with_name("config.example.json"))
FONTES = ("brapi_quote", "yahoo_chart", "fundamentus", "sgs", "focus_anual", "baixar_tesouro")
ORIGINAIS = {nome: getattr(c, nome, None) for nome in FONTES}
CFG ={"indices_yahoo": {"IBOV": "^BVSP", "USDBRL": "BRL=X"}, "brapi_token_env": "BRAPI_TOKEN"}

ATIVOS = [
    {"codigo": "FIIB11", "tipo": "FII", "quantidade": 7, "valor_atualizado": 900.0},
    {"codigo": "FIIA11", "tipo": "FII", "quantidade": 53, "valor_atualizado": 800.0},
    {"codigo": "Tesouro Prefixado 2032", "tipo": "Tesouro Direto", "quantidade": 0.74,
     "valor_atualizado": 570.0, "tesouro_tipo": "Tesouro Prefixado", "vencimento": "01/01/2032"},
    {"codigo": "CDB FICTICIO", "tipo": "Renda fixa", "quantidade": None, "valor_atualizado": 318.47},
]

PRECOS = {"FIIA11": 8.92, "FIIB11": 74.63, "ACAO4": 15.31}

PREGAO = datetime(2026, 10, 23, 11, 0, tzinfo=c.TZ)       # sexta, pregão aberto
FECHAMENTO = datetime(2026, 10, 23, 18, 30, tzinfo=c.TZ)  # sexta, depois do fechamento
FERIADO = datetime(2026, 10, 12, 11, 0, tzinfo=c.TZ)      # Nossa Senhora Aparecida


class Resp:
    def __init__(self, status=200, corpo=None, texto=""):
        self.status_code = status
        self._corpo = corpo
        self.text = texto

    def json(self):
        return self._corpo


class Sessao:
    """Sessão HTTP falsa para o Banco: GET devolve os ativos, POST é registrado."""

    def __init__(self, ativos):
        self._ativos = ativos
        self.chamadas = []

    def get(self, url, **kw):
        self.chamadas.append(("GET", url, None))
        return Resp(200, [dict(a) for a in self._ativos])

    def post(self, url, **kw):
        self.chamadas.append(("POST", url, json.loads(kw["data"])))
        return Resp(201)

    def delete(self, url, **kw):
        self.chamadas.append(("DELETE", url, None))
        return Resp(204)

    def posts(self, tabela):
        return [corpo for m, url, corpo in self.chamadas
                if m == "POST" and url.split("/rest/v1/")[1].split("?")[0] == tabela]


class Base(unittest.TestCase):
    def setUp(self):
        self.falhas = set()  # tickers cuja brapi e Yahoo falham
        self.downloads = 0
        self.trocar(
            brapi_quote=self.brapi,
            yahoo_chart=self.yahoo,
            fundamentus=lambda kind: c.parse_fundamentus(FII_HTML if kind == "fii" else ACAO_HTML, kind),
            sgs=lambda codigo, n: [{"data": date(2026, 9, 1), "valor": 0.5}] * n,
            focus_anual=lambda ind, ano: {"data": "2026-10-23", "mediana": 4.0},
            baixar_tesouro=self.baixar,
        )
        self.quando = FECHAMENTO.replace(hour=17, minute=0)

    def trocar(self, **kw):
        for nome, valor in kw.items():
            antigo = getattr(c, nome)
            setattr(c, nome, valor)
            self.addCleanup(setattr, c, nome, antigo)

    def brapi(self, ticker, token):
        if ticker in self.falhas:
            raise RuntimeError(f"HTTP 500 em brapi.dev/api/quote/{ticker}")
        return {"price": PRECOS[ticker], "as_of": self.quando, "prev_close": PRECOS[ticker] - 0.1}

    def yahoo(self, simbolo, rng="1y"):
        if not simbolo.endswith(".SA"):  # índice
            return {"price": 130000.0, "as_of": self.quando, "prev_close": 129000.0}
        ticker = simbolo[:-3]
        if ticker in self.falhas:
            raise RuntimeError(f"HTTP 404 em query1.finance.yahoo.com/v8/finance/chart/{simbolo}")
        p = PRECOS[ticker]
        return {"price": p, "as_of": self.quando, "prev_close": p - 0.1, "low52": p * 0.8,
                "high52": p * 1.2, "ultimo_div": {"valor": 0.09, "data": "2026-10-15"}, "div_12m": 1.1}

    def baixar(self, url):
        self.downloads += 1
        return TESOURO_CSV

    def banco(self, ativos=ATIVOS):
        s = Sessao(ativos)
        return Banco("https://exemplo.supabase.co", "sb_secret_FICTICIA", sessao=s), s

    def executar(self, modo, banco, agora, cfg=CFG):
        with contextlib.redirect_stdout(io.StringIO()):
            return c.executar(modo, banco, cfg, agora)


class TestCotacoes(Base):
    def test_falha_de_um_ticker_nao_apaga_preco_anterior(self):
        self.falhas = {"FIIA11"}
        linhas = c.coletar_cotacoes(ATIVOS, {}, None, PREGAO.date())
        por = {l["codigo"]: l for l in linhas}
        self.assertEqual(set(por), {"FIIA11", "FIIB11"})  # só ativos de bolsa
        self.assertEqual(set(por["FIIA11"]), {"codigo", "erro", "atualizado_em", "defasado"})
        self.assertIs(por["FIIA11"]["defasado"], True)  # não deixa o preço antigo parecer fresco
        for k in ("preco", "as_of", "variacao_dia_pct", "preco_fonte", "prev_close"):
            self.assertNotIn(k, por["FIIA11"])
        self.assertIn("brapi", por["FIIA11"]["erro"])
        self.assertEqual(por["FIIB11"]["preco"], 74.63)
        self.assertIsNone(por["FIIB11"]["erro"])

    def test_falha_vai_em_post_separado_sem_preco(self):
        self.falhas = {"FIIA11"}
        b, s = self.banco()
        erros = self.executar("pregao", b, PREGAO)
        corpos = s.posts("cotacoes")
        self.assertEqual(len(corpos), 2)
        for corpo in corpos:
            self.assertEqual(len({frozenset(l) for l in corpo}), 1)  # cada POST é uniforme
        falha = next(corpo for corpo in corpos if corpo[0]["codigo"] == "FIIA11")
        self.assertEqual(len(falha), 1)
        self.assertNotIn("preco", falha[0])
        self.assertTrue(falha[0]["defasado"])
        self.assertTrue(erros)

    def test_mapeia_colunas_da_tabela_cotacoes(self):
        fund = c.parse_fundamentus(FII_HTML, "fii")
        l, = c.coletar_cotacoes([ATIVOS[1]], fund, None, FECHAMENTO.date())
        self.assertEqual(l["preco"], 8.92)
        self.assertEqual(l["preco_fonte"], "brapi")
        self.assertEqual(l["as_of"], "2026-10-23T17:00:00-03:00")
        self.assertFalse(l["defasado"])
        self.assertEqual(l["prev_close"], 8.92 - 0.1)
        self.assertEqual(l["faixa52_min"], round(8.92 * 0.8, 2))
        self.assertEqual(l["faixa52_max"], round(8.92 * 1.2, 2))
        self.assertNotIn("faixa52", l)
        self.assertEqual(l["dy_12m_pct"], 12.71)  # Fundamentus tem prioridade
        self.assertEqual(l["pvp"], 1.01)
        self.assertIn("vpa", l)
        self.assertEqual(l["ultimo_rendimento"], {"valor": 0.09, "data": "2026-10-15"})
        self.assertEqual(l["proventos_12m"], 1.1)
        self.assertEqual(l["verificacao"], {"brapi_x_yahoo_pct": 0.0, "divergente": False})
        self.assertIsNone(l["erro"])
        colunas = {"codigo", "preco", "preco_fonte", "as_of", "defasado", "variacao_dia_pct",
                   "prev_close", "faixa52_min", "faixa52_max", "posicao_faixa52_pct", "pvp", "vpa",
                   "pl", "dy_12m_pct", "ultimo_rendimento", "proventos_12m", "verificacao",
                   "avisos", "erro", "atualizado_em"}
        self.assertLessEqual(set(l), colunas)

    def test_dy_calculado_sem_fundamentus(self):
        l, = c.coletar_cotacoes([ATIVOS[1]], {}, None, FECHAMENTO.date())
        self.assertEqual(l["dy_12m_pct"], round(1.1 / 8.92 * 100, 2))

    def test_pregao_omite_pvp_vpa_pl(self):
        b, s = self.banco()
        self.executar("pregao", b, PREGAO)
        linhas = [l for corpo in s.posts("cotacoes") for l in corpo]
        self.assertEqual(len(linhas), 2)
        for l in linhas:
            for k in ("pvp", "vpa", "pl"):
                self.assertNotIn(k, l)

    def test_montar_ativo_devolve_prev_close(self):
        a = c.montar_ativo("FIIA11", "fii", {}, None, FECHAMENTO.date())
        self.assertEqual(a["prev_close"], 8.92 - 0.1)


class TestSnapshot(Base):
    def cotacoes(self, quando):
        return {
            "FIIB11": {"codigo": "FIIB11", "preco": 74.63, "as_of": c.iso(quando)},
            "FIIA11": {"codigo": "FIIA11", "preco": 8.92, "as_of": c.iso(quando)},
        }

    def test_snapshot_soma_posicoes(self):
        tes = {"Tesouro Prefixado 2032": {"codigo": "Tesouro Prefixado 2032", "pu_venda": 412.30}}
        snap = c.montar_snapshot(ATIVOS, self.cotacoes(self.quando), tes, date(2026, 10, 23))
        self.assertEqual(snap["data"], "2026-10-23")
        self.assertEqual(snap["patrimonio"], round(7 * 74.63 + 53 * 8.92 + 0.74 * 412.30 + 318.47, 2))
        self.assertEqual(snap["patrimonio"], 1618.74)
        self.assertEqual(snap["posicoes"], {
            "FIIB11": 522.41, "FIIA11": 472.76, "Tesouro Prefixado 2032": 305.10, "CDB FICTICIO": 318.47})

    def test_snapshot_nao_grava_com_ativo_sem_preco_do_dia(self):
        cot = self.cotacoes(self.quando)
        cot["FIIA11"]["as_of"] = c.iso(datetime(2026, 10, 22, 17, 0, tzinfo=c.TZ))
        self.assertIsNone(c.montar_snapshot(ATIVOS, cot, {}, date(2026, 10, 23)))
        cot = self.cotacoes(self.quando)
        cot["FIIA11"] = {"codigo": "FIIA11", "erro": "x", "atualizado_em": "2026-10-23T18:30:00-03:00"}
        self.assertIsNone(c.montar_snapshot(ATIVOS, cot, {}, date(2026, 10, 23)))
        cot = self.cotacoes(self.quando)
        del cot["FIIA11"]
        self.assertIsNone(c.montar_snapshot(ATIVOS, cot, {}, date(2026, 10, 23)))

    def test_snapshot_none_sem_valor_para_uma_posicao(self):
        # Tesouro sem preço do CSV e sem valor da planilha: não conta 0
        ativos = [dict(a) for a in ATIVOS]
        ativos[2]["valor_atualizado"] = None
        self.assertIsNone(c.montar_snapshot(ativos, self.cotacoes(self.quando), {}, date(2026, 10, 23)))
        # renda fixa sem valor também
        ativos = [dict(a) for a in ATIVOS]
        ativos[3]["valor_atualizado"] = None
        self.assertIsNone(c.montar_snapshot(ativos, self.cotacoes(self.quando), {}, date(2026, 10, 23)))

    def test_snapshot_tesouro_sem_csv_usa_planilha_e_avisa_sem_titulo(self):
        avisos = []
        snap = c.montar_snapshot(ATIVOS, self.cotacoes(self.quando), {}, date(2026, 10, 23), avisos)
        self.assertEqual(snap["posicoes"]["Tesouro Prefixado 2032"], 570.0)
        self.assertEqual(avisos, ["snapshot: 1 posições do Tesouro estimadas pelo valor da planilha"])
        self.assertNotIn("Prefixado", " ".join(avisos))

    def test_snapshot_normal_nao_avisa(self):
        avisos = []
        tes = {"Tesouro Prefixado 2032": {"codigo": "Tesouro Prefixado 2032", "pu_venda": 412.30}}
        c.montar_snapshot(ATIVOS, self.cotacoes(self.quando), tes, date(2026, 10, 23), avisos)
        self.assertEqual(avisos, [])

    def test_fechamento_avisa_estimativa_do_tesouro(self):
        self.trocar(baixar_tesouro=lambda url: "")  # CSV sem o título: parse falha, planilha vale
        b, s = self.banco()
        erros = self.executar("fechamento", b, FECHAMENTO)
        self.assertIn("snapshot: 1 posições do Tesouro estimadas pelo valor da planilha", erros)
        snap, = s.posts("snapshots")
        self.assertEqual(snap[0]["posicoes"]["Tesouro Prefixado 2032"], 570.0)
        self.assertNotIn("Prefixado", " ".join(erros))

    def test_fechamento_normal_nao_avisa_estimativa(self):
        b, _ = self.banco()
        erros = self.executar("fechamento", b, FECHAMENTO)
        self.assertFalse(any("estimadas" in e for e in erros))


class TestTesouro(Base):
    def test_linha_do_tesouro_pelo_codigo_do_ativo(self):
        ativos = ATIVOS + [
            {"codigo": "Tesouro Selic 2031", "tipo": "Tesouro Direto", "quantidade": 0.1,
             "tesouro_tipo": "Tesouro Selic", "vencimento": "01/03/2031"},
            {"codigo": "Tesouro sem dados", "tipo": "Tesouro Direto", "quantidade": 1,
             "tesouro_tipo": None, "vencimento": None},
        ]
        linhas = c.coletar_tesouro(ativos, CFG)
        self.assertEqual(self.downloads, 1)
        por = {l["codigo"]: l for l in linhas}
        self.assertEqual(set(por), {"Tesouro Prefixado 2032", "Tesouro Selic 2031"})
        l = por["Tesouro Prefixado 2032"]
        self.assertEqual(l["data_base"], "2026-10-23")
        self.assertEqual(l["pu_venda"], 412.30)
        self.assertEqual(l["taxa_venda"], 12.87)
        self.assertEqual(set(l), {"codigo", "data_base", "taxa_compra", "taxa_venda",
                                  "pu_compra", "pu_venda", "atualizado_em"})

    def test_sem_titulos_nao_baixa(self):
        self.assertEqual(c.coletar_tesouro(ATIVOS[:2], CFG), [])
        self.assertEqual(self.downloads, 0)


class TestModos(Base):
    def test_pregao_em_feriado_nao_faz_nada(self):
        b, s = self.banco()
        self.assertEqual(self.executar("pregao", b, FERIADO), [])
        self.assertEqual(s.chamadas, [])

    def test_fechamento_em_feriado_nao_faz_nada(self):
        b, s = self.banco()
        self.assertEqual(self.executar("fechamento", b, FERIADO.replace(hour=19)), [])
        self.assertEqual(s.chamadas, [])

    def test_pregao_grava_cotacoes_e_indices_sem_fundamentus(self):
        chamados = []
        self.trocar(fundamentus=lambda kind: chamados.append(kind) or {})
        b, s = self.banco()
        erros = self.executar("pregao", b, PREGAO)
        self.assertEqual(erros, [])
        self.assertEqual(chamados, [])
        self.assertEqual(len([l for corpo in s.posts("cotacoes") for l in corpo]), 2)
        ind, briefing = s.posts("indicadores")
        self.assertEqual(ind[0]["chave"], "indices")
        self.assertEqual(set(ind[0]["valor"]), {"IBOV", "USDBRL"})
        self.assertEqual(briefing[0]["chave"], "briefing_mercado")
        self.assertEqual(s.posts("snapshots"), [])
        self.assertEqual(s.posts("tesouro"), [])

    def test_fechamento_grava_tudo(self):
        b, s = self.banco()
        erros = self.executar("fechamento", b, FECHAMENTO)
        self.assertEqual(erros, [])
        linhas = {l["codigo"]: l for corpo in s.posts("cotacoes") for l in corpo}
        self.assertEqual(linhas["FIIA11"]["pvp"], 1.01)
        chaves = [corpo[0]["chave"] for corpo in s.posts("indicadores")]
        self.assertEqual(sorted(chaves), ["briefing_mercado", "indices", "macro"])
        macro = next(corpo[0]["valor"] for corpo in s.posts("indicadores") if corpo[0]["chave"] == "macro")
        self.assertIn("selic_meta", macro)
        self.assertIn("focus", macro)
        tes, = s.posts("tesouro")
        self.assertEqual(tes[0]["codigo"], "Tesouro Prefixado 2032")
        snap, = s.posts("snapshots")
        self.assertEqual(snap[0]["patrimonio"], 1618.74)

    def test_fechamento_grava_snapshot_uma_vez_por_data(self):
        b, s = self.banco()
        self.executar("fechamento", b, FECHAMENTO)
        self.executar("fechamento", b, FECHAMENTO.replace(hour=20))
        urls = [url for m, url, _ in s.chamadas if m == "POST" and "/snapshots" in url]
        self.assertEqual(len(urls), 2)
        self.assertTrue(all(u.endswith("?on_conflict=data") for u in urls))
        datas = [corpo[0]["data"] for corpo in s.posts("snapshots")]
        self.assertEqual(datas, ["2026-10-23", "2026-10-23"])

    def test_fechamento_sem_preco_do_dia_nao_grava_snapshot(self):
        self.falhas = {"FIIA11"}
        b, s = self.banco()
        erros = self.executar("fechamento", b, FECHAMENTO)
        self.assertEqual(s.posts("snapshots"), [])
        self.assertTrue(any("snapshot" in e for e in erros))

    def test_erros_nao_citam_tickers(self):
        # A carteira não pode aparecer em lugar público (logs do CI são públicos).
        self.falhas = {"FIIA11"}
        b, _ = self.banco()
        erros = self.executar("fechamento", b, FECHAMENTO)
        self.assertTrue(erros)
        texto = " ".join(erros)
        for nome in ("FIIA11", "FIIB11", "Prefixado"):
            self.assertNotIn(nome, texto)


class TestMain(Base):
    def setUp(self):
        super().setUp()
        # todas as fontes passam pelo get() real; a rede falha com o token na mensagem
        self.trocar(_agora=lambda: FECHAMENTO, _ultima_brapi=None, **ORIGINAIS)

        def rede(url, **kw):
            raise requests.ConnectionError(f"falha em {url}?token={SEGREDO} Bearer {SEGREDO}")

        orig = (c.requests.get, c.time.sleep)
        c.requests.get, c.time.sleep = rede, (lambda s: None)
        self.addCleanup(setattr, c.requests, "get", orig[0])
        self.addCleanup(setattr, c.time, "sleep", orig[1])

    def rodar(self, modo, banco):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"BRAPI_TOKEN": SEGREDO}), \
                mock.patch.object(c.Banco, "do_ambiente", return_value=banco), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = c.main(["--modo", modo, "--config", CONFIG_EXEMPLO])
        return rc, out.getvalue(), err.getvalue()

    def test_main_nunca_imprime_nem_grava_o_token(self):
        for modo in ("pregao", "fechamento"):
            b, s = self.banco()
            rc, out, err = self.rodar(modo, b)
            self.assertEqual(rc, 1)  # havia ativos e nenhum foi gravado
            self.assertTrue(err)
            gravado = json.dumps([corpo for _, _, corpo in s.chamadas], ensure_ascii=False)
            self.assertIn("FIIA11", gravado)  # a linha de erro foi gravada
            for texto in (gravado, out, err):
                self.assertNotIn(SEGREDO, texto)
            for nome in ("FIIA11", "FIIB11"):
                self.assertNotIn(nome, out + err)

    def test_main_sem_banco_sai_com_1(self):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(c.Banco, "do_ambiente",
                               side_effect=RuntimeError("variável de ambiente ausente: SUPABASE_URL")), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = c.main(["--modo", "pregao"])
        self.assertEqual(rc, 1)
        self.assertIn("SUPABASE_URL", err.getvalue())

    def test_main_sucesso_sai_com_0(self):
        self.trocar(brapi_quote=self.brapi, yahoo_chart=self.yahoo)
        b, s = self.banco(ATIVOS[:2])
        rc, _, _ = self.rodar("pregao", b)
        self.assertEqual(rc, 0)
        self.assertEqual(len(s.posts("cotacoes")), 1)


if __name__ == "__main__":
    unittest.main()
