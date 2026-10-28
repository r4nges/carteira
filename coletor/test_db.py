import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from db import Banco

URL = "https://exemplo.supabase.co"
CHAVE_NOVA = "sb_secret_FICTICIA123"
CHAVE_JWT = "eyJFICTICIA.payload.assinatura"


class Resp:
    def __init__(self, status=200, corpo=None, texto=""):
        self.status_code = status
        self._corpo = corpo
        self.text = texto

    def json(self):
        return self._corpo


class Sessao:
    def __init__(self, resp=None):
        self.resp = resp or Resp()
        self.chamadas = []

    def _reg(self, metodo, url, **kw):
        self.chamadas.append((metodo, url, kw))
        return self.resp

    def post(self, url, **kw):
        return self._reg("POST", url, **kw)

    def get(self, url, **kw):
        return self._reg("GET", url, **kw)

    def delete(self, url, **kw):
        return self._reg("DELETE", url, **kw)


class Testes(unittest.TestCase):
    def banco(self, resp=None, chave=CHAVE_NOVA, url=URL):
        s = Sessao(resp)
        return Banco(url, chave, sessao=s), s

    def test_upsert_requisicao(self):
        b, s = self.banco()
        b.upsert("cotacoes", [{"codigo": "AAAA11", "preco": 1.5}], "codigo")
        (metodo, url, kw), = s.chamadas
        self.assertEqual(metodo, "POST")
        self.assertEqual(url, f"{URL}/rest/v1/cotacoes?on_conflict=codigo")
        self.assertEqual(kw["headers"]["Prefer"], "resolution=merge-duplicates")
        self.assertEqual(kw["headers"]["Content-Type"], "application/json")
        self.assertEqual(json.loads(kw["data"]),
                         [{"codigo": "AAAA11", "preco": 1.5}])
        self.assertEqual(kw["timeout"], 30)

    def test_upsert_agrupa_por_conjunto_de_chaves(self):
        # PostgREST usa a união das chaves no lote; linha parcial misturada com
        # linha completa gravaria NULL por cima do preço existente.
        b, s = self.banco()
        linhas = [
            {"codigo": "FIIA11", "preco": 1.5, "erro": None},
            {"codigo": "FIIB11", "erro": "falhou"},
            {"erro": None, "preco": 2.5, "codigo": "ACAO4"},
        ]
        b.upsert("cotacoes", linhas, "codigo")
        self.assertEqual(len(s.chamadas), 2)
        corpos = [json.loads(kw["data"]) for _, _, kw in s.chamadas]
        self.assertEqual(corpos[0], [linhas[0], linhas[2]])  # ordem da primeira aparição
        self.assertEqual(corpos[1], [linhas[1]])
        for corpo in corpos:
            self.assertEqual(len({frozenset(l) for l in corpo}), 1)
        for _, url, _ in s.chamadas:
            self.assertEqual(url, f"{URL}/rest/v1/cotacoes?on_conflict=codigo")

    def test_upsert_mesmas_chaves_um_post(self):
        b, s = self.banco()
        b.upsert("cotacoes", [{"codigo": "A", "preco": 1}, {"preco": 2, "codigo": "B"}], "codigo")
        self.assertEqual(len(s.chamadas), 1)
        self.assertEqual(len(json.loads(s.chamadas[0][2]["data"])), 2)

    def test_salvar_tesouro(self):
        b, s = self.banco()
        b.salvar_tesouro([{"codigo": "Tesouro X", "pu_venda": 1.0}])
        self.assertEqual(s.chamadas[0][1], f"{URL}/rest/v1/tesouro?on_conflict=codigo")

    def test_chave_nova_so_apikey(self):
        b, s = self.banco(chave=CHAVE_NOVA)
        b.upsert("t", [{"a": 1}], "a")
        h = s.chamadas[0][2]["headers"]
        self.assertEqual(h["apikey"], CHAVE_NOVA)
        self.assertNotIn("Authorization", h)

    def test_chave_jwt_envia_bearer(self):
        b, s = self.banco(chave=CHAVE_JWT)
        b.upsert("t", [{"a": 1}], "a")
        h = s.chamadas[0][2]["headers"]
        self.assertEqual(h["apikey"], CHAVE_JWT)
        self.assertEqual(h["Authorization"], f"Bearer {CHAVE_JWT}")

    def test_barra_final_removida(self):
        b, s = self.banco(url=URL + "/")
        b.upsert("t", [{"a": 1}], "a")
        self.assertEqual(s.chamadas[0][1], f"{URL}/rest/v1/t?on_conflict=a")

    def test_lista_vazia_nao_chama(self):
        b, s = self.banco()
        b.upsert("t", [], "a")
        b.salvar_cotacoes([])
        b.salvar_noticias([])
        self.assertEqual(s.chamadas, [])

    def test_ativos(self):
        b, s = self.banco(Resp(200, [{"codigo": "AAAA11"}]))
        self.assertEqual(b.ativos(), [{"codigo": "AAAA11"}])
        metodo, url, kw = s.chamadas[0]
        self.assertEqual(metodo, "GET")
        self.assertEqual(url, f"{URL}/rest/v1/ativos?select=*")
        self.assertEqual(kw["timeout"], 30)

    def test_erro_inclui_status_e_corpo_sem_segredo(self):
        corpo = "x" * 300
        b, _ = self.banco(Resp(401, texto=corpo), chave=CHAVE_JWT)
        with self.assertRaises(RuntimeError) as cm:
            b.upsert("cotacoes", [{"a": 1}], "a")
        msg = str(cm.exception)
        self.assertIn("POST", msg)
        self.assertIn("cotacoes", msg)
        self.assertIn("401", msg)
        self.assertIn("x" * 200, msg)
        self.assertNotIn("x" * 201, msg)
        self.assertNotIn(CHAVE_JWT, msg)

    def test_erro_no_get(self):
        b, _ = self.banco(Resp(500, texto="falhou"))
        with self.assertRaises(RuntimeError) as cm:
            b.ativos()
        self.assertIn("GET", str(cm.exception))
        self.assertIn("ativos", str(cm.exception))
        self.assertIn("500", str(cm.exception))
        self.assertIn("falhou", str(cm.exception))

    def test_atalhos_de_conflito(self):
        b, s = self.banco()
        b.salvar_cotacoes([{"codigo": "A"}])
        b.salvar_indicador("indices", {"x": 1})
        b.salvar_snapshot({"data": "2026-01-02", "patrimonio": 1})
        b.salvar_noticias([{"id": "n1"}])
        urls = [c[1] for c in s.chamadas]
        self.assertEqual(urls, [
            f"{URL}/rest/v1/cotacoes?on_conflict=codigo",
            f"{URL}/rest/v1/indicadores?on_conflict=chave",
            f"{URL}/rest/v1/snapshots?on_conflict=data",
            f"{URL}/rest/v1/noticias?on_conflict=id",
        ])
        self.assertEqual(json.loads(s.chamadas[1][2]["data"]),
                         [{"chave": "indices", "valor": {"x": 1}}])
        self.assertEqual(json.loads(s.chamadas[2][2]["data"]),
                         [{"data": "2026-01-02", "patrimonio": 1}])

    def test_limpar_noticias(self):
        b, s = self.banco()
        antes = datetime.now(timezone.utc)
        b.limpar_noticias(dias=7)
        metodo, url, kw = s.chamadas[0]
        self.assertEqual(metodo, "DELETE")
        base, _, filtro = url.partition("?coletado_em=lt.")
        self.assertEqual(base, f"{URL}/rest/v1/noticias")
        corte = datetime.strptime(filtro, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
        esperado = antes - timedelta(days=7)
        self.assertLess(abs((corte - esperado).total_seconds()), 5)
        self.assertEqual(kw["timeout"], 30)

    def test_do_ambiente(self):
        env = {"SUPABASE_URL": URL + "/", "SUPABASE_SERVICE_KEY": CHAVE_NOVA}
        with mock.patch.dict(os.environ, env, clear=True):
            b = Banco.do_ambiente()
        self.assertEqual(b.url, URL)

    def test_do_ambiente_variavel_ausente(self):
        for faltando in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
            env = {"SUPABASE_URL": URL, "SUPABASE_SERVICE_KEY": CHAVE_NOVA}
            del env[faltando]
            with mock.patch.dict(os.environ, env, clear=True):
                with self.assertRaises(RuntimeError) as cm:
                    Banco.do_ambiente()
            self.assertIn(faltando, str(cm.exception))
            self.assertNotIn(CHAVE_NOVA, str(cm.exception))


if __name__ == "__main__":
    unittest.main()
