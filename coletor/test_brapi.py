import contextlib
import io
import traceback
import unittest
from datetime import datetime

import requests

import coletor as c

SEGREDO = "SEGREDO123"


class Resp:
    def __init__(self, status=200, headers=None, body=None):
        self.status_code = status
        self.headers = headers or {}
        self._body = body
        self.content = b""

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(
                f"{self.status_code} Client Error for url: https://brapi.dev/api/quote/X?token={SEGREDO}"
            )

    def json(self):
        return self._body


BRAPI_OK = {"results": [{
    "regularMarketPrice": 10.0,
    "regularMarketTime": 1761249600,
    "regularMarketPreviousClose": 9.9,
}]}


class Base(unittest.TestCase):
    def setUp(self):
        self.chamadas = []   # (url, kwargs) de cada requests.get
        self.sonos = []      # argumentos de cada time.sleep
        self.respostas = []  # fila de Resp ou exceções

        def fake_get(url, **kw):
            self.chamadas.append((url, kw))
            r = self.respostas.pop(0)
            if isinstance(r, BaseException):
                raise r
            return r

        orig = (requests.get, c.time.sleep, c._ultima_brapi)
        requests.get = fake_get
        c.time.sleep = self.sonos.append
        c._ultima_brapi = None

        def restaurar():
            requests.get, c.time.sleep, c._ultima_brapi = orig

        self.addCleanup(restaurar)


class TestGet429(Base):
    def test_429_retry_after_3_uma_nova_tentativa(self):
        self.respostas = [Resp(429, {"Retry-After": "3"}), Resp(200, body={"ok": 1})]
        r = c.get("https://x.test/a")
        self.assertEqual(r.json(), {"ok": 1})
        self.assertEqual(len(self.chamadas), 2)
        self.assertEqual(self.sonos, [3])

    def test_429_retry_after_500_limitado_a_60(self):
        self.respostas = [Resp(429, {"Retry-After": "500"}), Resp(200)]
        c.get("https://x.test/a")
        self.assertEqual(self.sonos, [60])

    def test_429_sem_retry_after_ou_invalido_usa_5(self):
        self.respostas = [Resp(429), Resp(429, {"Retry-After": "amanha"}), Resp(200)]
        c.get("https://x.test/a")
        self.assertEqual(self.sonos, [5, 5])

    def test_429_esgota_tentativas_levanta_erro_sanitizado(self):
        self.respostas = [Resp(429, {"Retry-After": "1"}) for _ in range(3)]
        with self.assertRaises(RuntimeError) as cm:
            c.get("https://brapi.dev/api/quote/X?token=" + SEGREDO)
        self.assertEqual(len(self.chamadas), 3)
        self.assertEqual(str(cm.exception), "HTTP 429 em brapi.dev/api/quote/X")

    def test_erro_http_sem_query_string(self):
        self.respostas = [Resp(500), Resp(500), Resp(500)]
        with self.assertRaises(RuntimeError) as cm:
            c.get("https://brapi.dev/api/quote/X", params={"token": SEGREDO})
        self.assertEqual(str(cm.exception), "HTTP 500 em brapi.dev/api/quote/X")
        self.assertNotIn(SEGREDO, str(cm.exception))

    def test_nao_dorme_depois_da_ultima_tentativa(self):
        self.respostas = [Resp(500), Resp(500), Resp(500)]
        with self.assertRaises(RuntimeError):
            c.get("https://x.test/a")
        self.assertEqual(len(self.chamadas), 3)
        self.assertEqual(self.sonos, [1.5, 3.0])

    def test_erro_de_rede_sem_texto_original(self):
        e = requests.ConnectionError(f"falha em https://brapi.dev/api/quote/X?token={SEGREDO}")
        self.respostas = [e, e, e]
        with self.assertRaises(RuntimeError) as cm:
            c.get("https://brapi.dev/api/quote/X?token=" + SEGREDO)
        self.assertEqual(str(cm.exception), "ConnectionError em brapi.dev/api/quote/X")


class TestBrapiQuote(Base):
    def test_pausa_constante(self):
        self.assertEqual(c.PAUSA_BRAPI, 1.1)

    def test_duas_chamadas_esperam_pausa(self):
        self.respostas = [Resp(200, body=BRAPI_OK), Resp(200, body=BRAPI_OK)]
        c.brapi_quote("AAAA3", "tok")
        self.assertEqual(self.sonos, [])  # primeira chamada não espera
        c.brapi_quote("BBBB3", "tok")
        self.assertEqual(len(self.sonos), 1)
        self.assertGreater(self.sonos[0], 0)
        self.assertLessEqual(self.sonos[0], c.PAUSA_BRAPI)

    def test_sem_pausa_se_ja_passou_tempo(self):
        self.respostas = [Resp(200, body=BRAPI_OK), Resp(200, body=BRAPI_OK)]
        c.brapi_quote("AAAA3", None)
        c._ultima_brapi -= 10  # simula 10 s decorridos
        c.brapi_quote("BBBB3", None)
        self.assertEqual(self.sonos, [])

    def test_token_no_cabecalho_e_nao_na_url(self):
        self.respostas = [Resp(200, body=BRAPI_OK)]
        r = c.brapi_quote("AAAA3", SEGREDO)
        self.assertEqual(r["price"], 10.0)
        url, kw = self.chamadas[0]
        self.assertEqual(kw["headers"]["Authorization"], f"Bearer {SEGREDO}")
        self.assertNotIn(SEGREDO, url)
        self.assertNotIn("token", url)
        self.assertFalse(kw.get("params"))

    def test_sem_token_sem_cabecalho_authorization(self):
        self.respostas = [Resp(200, body=BRAPI_OK)]
        c.brapi_quote("AAAA3", None)
        _, kw = self.chamadas[0]
        self.assertNotIn("Authorization", kw["headers"])
        self.assertFalse(kw.get("params"))

    def test_erro_brapi_nao_vaza_token(self):
        e = requests.ConnectionError(f"boom https://brapi.dev/api/quote/X?token={SEGREDO}")
        self.respostas = [e, e, e]
        with self.assertRaises(RuntimeError) as cm:
            c.brapi_quote("X", SEGREDO)
        self.assertNotIn(SEGREDO, str(cm.exception))

    def test_excecao_sem_cadeia_nem_token_no_traceback(self):
        e = requests.ConnectionError(f"boom https://brapi.dev/api/quote/X?token={SEGREDO} Bearer {SEGREDO}")
        self.respostas = [e, e, e]
        with self.assertRaises(RuntimeError) as cm:
            c.brapi_quote("X", SEGREDO)
        exc = cm.exception
        self.assertIsNone(exc.__cause__)
        self.assertIsNone(exc.__context__)
        texto = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        self.assertNotIn(SEGREDO, texto)

    def test_montar_ativo_avisos_sem_token(self):
        antes = (c.brapi_quote, c.yahoo_chart)
        try:
            fresco = datetime(2026, 10, 23, 17, 0, tzinfo=c.TZ)
            c.brapi_quote = lambda t, tok: (_ for _ in ()).throw(
                RuntimeError(f"falhou https://brapi.dev/x?token={SEGREDO} Bearer {SEGREDO}"))
            c.yahoo_chart = lambda s, r="1y": {
                "price": 8.9, "as_of": fresco, "prev_close": 8.7,
                "low52": 8.0, "high52": 10.0, "ultimo_div": None, "div_12m": None}
            a = c.montar_ativo("FIIA11", "fii", {}, SEGREDO, fresco.date())
        finally:
            c.brapi_quote, c.yahoo_chart = antes
        self.assertEqual(len(a["avisos"]), 1)
        self.assertNotIn(SEGREDO, " ".join(a["avisos"]))
        self.assertIn("***", a["avisos"][0])

    def test_montar_ativo_erro_final_sem_token(self):
        antes = (c.brapi_quote, c.yahoo_chart)
        try:
            def falha(*a, **k):
                raise RuntimeError(f"x ?apikey={SEGREDO}&y=1")
            c.brapi_quote = falha
            c.yahoo_chart = falha
            with self.assertRaises(RuntimeError) as cm:
                c.montar_ativo("FIIA11", "fii", {}, SEGREDO, datetime(2026, 10, 23).date())
        finally:
            c.brapi_quote, c.yahoo_chart = antes
        self.assertNotIn(SEGREDO, str(cm.exception))

    def test_executar_erros_sem_token(self):
        class BancoFalso:
            def __init__(self):
                self.gravado = []

            def ativos(self):
                return [{"codigo": "FIIA11", "tipo": "FII", "quantidade": 1}]

            def __getattr__(self, nome):  # salvar_*: registra o que seria gravado
                return lambda *a: self.gravado.append(a)

        antes = (c.fundamentus, c.montar_ativo, c.yahoo_chart, c.sgs, c.focus_anual)
        try:
            def falha(*a, **k):
                raise RuntimeError(f"url ?token={SEGREDO}")
            c.fundamentus = falha
            c.montar_ativo = falha
            c.yahoo_chart = falha
            c.sgs = falha
            c.focus_anual = falha
            banco = BancoFalso()
            with contextlib.redirect_stdout(io.StringIO()):
                erros = c.executar("fechamento", banco, {"indices_yahoo": {"x": "^X"}},
                                   datetime(2026, 10, 23, 18, 30, tzinfo=c.TZ))
        finally:
            c.fundamentus, c.montar_ativo, c.yahoo_chart, c.sgs, c.focus_anual = antes
        self.assertTrue(erros)
        self.assertNotIn(SEGREDO, " ".join(erros))
        self.assertNotIn(SEGREDO, repr(banco.gravado))


class TestRedigir(unittest.TestCase):
    def test_token(self):
        self.assertEqual(c.redigir("GET /q?token=abc123&x=1 falhou"), "GET /q?token=***&x=1 falhou")

    def test_token_ate_espaco(self):
        self.assertEqual(c.redigir("url ?token=abc123 fim"), "url ?token=*** fim")

    def test_apikey_e_api_key(self):
        self.assertEqual(c.redigir("a?apikey=ZZZ&b=2"), "a?apikey=***&b=2")
        self.assertEqual(c.redigir("a?api_key=ZZZ"), "a?api_key=***")

    def test_bearer(self):
        self.assertEqual(c.redigir("Authorization: Bearer abc.def-123 resto"), "Authorization: Bearer *** resto")

    def test_sem_segredo_inalterado(self):
        t = "HTTP 500 em brapi.dev/api/quote/ACAO4"
        self.assertEqual(c.redigir(t), t)


if __name__ == "__main__":
    unittest.main()
