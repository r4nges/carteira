"""Modo `noticias` e o briefing de mercado gravado por `pregao` e `fechamento`."""
import contextlib
import io
import os
import unittest
from datetime import datetime
from unittest import mock

import coletor as c
from db import Banco
from test_modos import ATIVOS, CONFIG_EXEMPLO, FECHAMENTO, FERIADO, PREGAO, SEGREDO, Base, Resp, Sessao

COLUNAS = {"id", "titulo", "lide", "fonte", "tema", "url", "publicado_em", "ativos", "tags",
           "grupo_id", "tambem_em", "score"}
AGORA = datetime(2026, 10, 26, 12, 0, tzinfo=c.TZ)  # segunda, 12h
SABADO = datetime(2026, 10, 24, 12, 0, tzinfo=c.TZ)
FONTES_FALSAS = [
    {"nome": "Jornal A", "url": "https://a.example/feed", "tema": "economia", "peso": 0.8, "encoding": None},
    {"nome": "Jornal B", "url": "https://b.example/feed", "tema": "politica", "peso": 0.7, "encoding": None},
]


def rss(*itens):
    corpo = "".join(
        f"<item><title>{t}</title><link>{u}</link><pubDate>{d}</pubDate><description>{ld}</description></item>"
        for t, u, d, ld in itens)
    return f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>{corpo}</channel></rss>'.encode()


FEED_A = rss(
    ("Governo anuncia pacote de obras", "https://a.example/1", "Mon, 26 Oct 2026 14:30:00 +0000", "Resumo um."),
    ("Rendimento do FIIA11 sobe em outubro", "https://a.example/2", "Mon, 26 Oct 2026 09:00:00 +0000", "Resumo dois."),
)
FEED_B = rss(
    ("Copom mantém Selic e dólar recua", "https://b.example/1", "Mon, 26 Oct 2026 14:00:00 +0000", "Resumo três."),
)
FEEDS = {"https://a.example/feed": FEED_A, "https://b.example/feed": FEED_B}


def falha(msg):
    def baixar(url):
        raise RuntimeError(msg)
    return baixar


class SessaoFalhaPost(Sessao):
    def post(self, url, **kw):
        return Resp(500, texto="erro interno")


class SessaoFalhaDelete(Sessao):
    def delete(self, url, **kw):
        return Resp(500, texto="erro interno")


def banco_com(sessao):
    return Banco("https://exemplo.supabase.co", "sb_secret_FICTICIA", sessao=sessao)


class TestNoticiasModo(Base):
    def setUp(self):
        super().setUp()
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS, baixar_feed=FEEDS.__getitem__)

    def test_grava_ordenado_por_score_e_limpa_7_dias(self):
        b, s = self.banco()
        self.assertEqual(self.executar("noticias", b, AGORA), [])
        posts = s.posts("noticias")
        self.assertEqual(len(posts), 1)  # linhas uniformes: um POST só
        linhas = posts[0]
        self.assertEqual(len(linhas), 3)
        scores = [linha["score"] for linha in linhas]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual(linhas[0]["titulo"], "Rendimento do FIIA11 sobe em outubro")  # cita ativo
        deletes = [url for m, url, _ in s.chamadas if m == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertIn("/rest/v1/noticias?coletado_em=lt.", deletes[0])
        self.assertEqual([m for m, url, _ in s.chamadas if "noticias" in url], ["POST", "DELETE"])

    def test_linhas_so_com_colunas_da_tabela(self):
        b, s = self.banco()
        self.executar("noticias", b, AGORA)
        ids = set()
        for linha in s.posts("noticias")[0]:
            self.assertEqual(set(linha), COLUNAS)
            self.assertRegex(linha["id"], r"^[0-9a-f]{16}$")
            self.assertNotEqual(linha["id"], linha["grupo_id"])
            self.assertIsInstance(linha["publicado_em"], str)
            self.assertIsInstance(linha["score"], float)
            ids.add(linha["id"])
        self.assertEqual(len(ids), 3)

    def test_id_estavel_entre_execucoes(self):
        ids = []
        for _ in range(2):
            b, s = self.banco()
            self.executar("noticias", b, AGORA)
            ids.append({linha["url"]: linha["id"] for linha in s.posts("noticias")[0]})
        self.assertEqual(ids[0], ids[1])

    def test_marca_ativos_e_tags_antes_de_pontuar(self):
        b, s = self.banco()
        self.executar("noticias", b, AGORA)
        por = {linha["url"]: linha for linha in s.posts("noticias")[0]}
        self.assertEqual(por["https://a.example/2"]["ativos"], ["FIIA11"])
        self.assertEqual(por["https://a.example/1"]["ativos"], [])
        self.assertEqual(por["https://b.example/1"]["tags"], ["cambio", "juros"])
        # peso 0,8 x 0,5 ** (6 h / 12) x (1 + 2 por citar ativo + 0,5 x 0 tags)
        self.assertAlmostEqual(por["https://a.example/2"]["score"], 0.8 * 0.5 ** 0.5 * 3, places=3)

    def test_roda_todo_dia_inclusive_feriado_e_fim_de_semana(self):
        for quando in (FERIADO, SABADO):
            self.trocar(baixar_feed=falha("HTTP 500 em x.example/feed"))
            b, s = self.banco()
            erros = self.executar("noticias", b, quando)
            self.assertIn("Jornal A: HTTP 500 em x.example/feed", erros)  # tentou baixar, não pulou o dia

    def test_fonte_com_erro_nao_derruba_as_outras(self):
        def baixar(url):
            if "b.example" in url:
                raise RuntimeError("HTTP 500 em b.example/feed")
            return FEED_A
        self.trocar(baixar_feed=baixar)
        b, s = self.banco()
        erros = self.executar("noticias", b, AGORA)
        self.assertEqual(erros, ["Jornal B: HTTP 500 em b.example/feed"])
        self.assertEqual(len(s.posts("noticias")[0]), 2)

    def test_todas_as_fontes_falhando_e_erro_de_execucao(self):
        self.trocar(baixar_feed=falha("HTTP 503 em x.example/feed"))
        b, s = self.banco()
        erros = self.executar("noticias", b, AGORA)
        self.assertIn(c.SEM_NOTICIAS, erros)
        self.assertEqual(len(erros), 3)  # uma por fonte e o aviso final
        self.assertEqual(s.posts("noticias"), [])

    def test_fontes_sem_itens_nao_e_erro(self):
        self.trocar(baixar_feed=lambda url: rss())
        b, s = self.banco()
        self.assertEqual(self.executar("noticias", b, AGORA), [])
        self.assertEqual(s.posts("noticias"), [])

    def test_itens_coletados_e_nada_salvo_e_erro_de_execucao(self):
        s = SessaoFalhaPost(ATIVOS)
        erros = self.executar("noticias", banco_com(s), AGORA)
        self.assertIn(c.SEM_NOTICIAS_SALVAS, erros)
        self.assertNotIn(c.SEM_GRAVACAO, erros)  # a mensagem dos ativos fala de "ativos a coletar"
        self.assertTrue(any(e.startswith("salvar_noticias:") for e in erros))

    def test_falha_na_limpeza_e_so_um_erro(self):
        s = SessaoFalhaDelete(ATIVOS)
        erros = self.executar("noticias", banco_com(s), AGORA)
        self.assertEqual(len(s.posts("noticias")[0]), 3)
        self.assertEqual(len(erros), 1)
        self.assertTrue(erros[0].startswith("limpar_noticias:"))

    def test_erros_nao_citam_ativos(self):
        self.trocar(baixar_feed=falha("HTTP 500 em a.example/feed"))
        b, _ = self.banco()
        texto = " ".join(self.executar("noticias", b, AGORA))
        for nome in ("FIIA11", "FIIB11"):
            self.assertNotIn(nome, texto)

    def test_resumo_nao_cita_titulos_nem_ativos(self):
        b, _ = self.banco()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            c.executar("noticias", b, {}, AGORA)
        self.assertIn("noticias:", out.getvalue())
        for trecho in ("FIIA11", "Rendimento", "Governo"):
            self.assertNotIn(trecho, out.getvalue())


def item_rss(titulo, url, data="Mon, 26 Oct 2026 14:00:00 +0000"):
    return (titulo, url, data, "Resumo.")


class TestNoticiasSemRepetirUrl(Base):
    """Um UPSERT com a mesma chave duas vezes no lote é recusado pelo Postgres e perderia tudo."""

    def setUp(self):
        super().setUp()
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS)

    def gravadas(self, feeds):
        self.trocar(baixar_feed=feeds.__getitem__)
        b, s = self.banco()
        erros = self.executar("noticias", b, AGORA)
        posts = s.posts("noticias")
        return erros, (posts[0] if posts else []), s

    def assertIdsUnicos(self, linhas):
        ids = [linha["id"] for linha in linhas]
        self.assertEqual(len(ids), len(set(ids)))

    def test_mesmo_item_duas_vezes_no_mesmo_feed(self):
        repetido = item_rss("Governo anuncia pacote de obras", "https://a.example/1")
        feed = rss(repetido, repetido)
        erros, linhas, _ = self.gravadas({"https://a.example/feed": feed, "https://b.example/feed": rss()})
        self.assertEqual(erros, [])
        self.assertEqual(len(linhas), 1)

    def test_mesma_url_com_titulos_diferentes_no_mesmo_feed(self):
        feed = rss(item_rss("Governo anuncia pacote de obras", "https://a.example/1"),
                   item_rss("Pacote de obras do governo é anunciado", "https://a.example/1"))
        _, linhas, _ = self.gravadas({"https://a.example/feed": feed, "https://b.example/feed": rss()})
        self.assertEqual(len(linhas), 1)
        self.assertIdsUnicos(linhas)

    def test_mesma_url_em_dois_feeds_fica_com_a_fonte_de_maior_peso(self):
        feeds = {
            "https://a.example/feed": rss(item_rss("Governo anuncia pacote de obras", "https://x.example/1")),
            "https://b.example/feed": rss(item_rss("Governo anuncia pacote de obras", "https://x.example/1"),
                                          item_rss("Outra notícia qualquer", "https://b.example/2")),
        }
        _, linhas, _ = self.gravadas(feeds)
        self.assertEqual(len(linhas), 2)
        self.assertIdsUnicos(linhas)
        por = {linha["url"]: linha for linha in linhas}
        self.assertEqual(por["https://x.example/1"]["fonte"], "Jornal A")  # peso 0,8 contra 0,7
        self.assertEqual(por["https://x.example/1"]["tambem_em"], [])

    def test_empate_de_peso_fica_com_a_mais_antiga(self):
        itens = [
            {"titulo": "Mesma notícia", "url": "https://x.example/1", "fonte": "Jornal A", "tema": "economia",
             "peso": 0.8, "lide": "", "publicado_em": datetime(2026, 10, 26, 14, 0, tzinfo=c.timezone.utc)},
            {"titulo": "Mesma notícia", "url": "https://x.example/1", "fonte": "Jornal B", "tema": "economia",
             "peso": 0.8, "lide": "", "publicado_em": datetime(2026, 10, 26, 13, 0, tzinfo=c.timezone.utc)},
        ]
        linhas = c.processar_noticias(itens, [], AGORA)
        self.assertEqual([(l["fonte"], l["tambem_em"]) for l in linhas], [("Jornal B", [])])

    def test_rede_de_seguranca_por_id_fica_com_o_maior_score(self):
        base = {"url": "https://x.example/1", "fonte": "Jornal A", "tema": "economia", "peso": 0.8, "lide": "",
                "grupo_id": "g", "tambem_em": [], "publicado_em": datetime(2026, 10, 26, 14, 0, tzinfo=c.timezone.utc)}
        saida_agrupar = [{**base, "titulo": "Um"}, {**base, "titulo": "Dois", "peso": 0.9}]
        with mock.patch.object(c, "agrupar", return_value=saida_agrupar):
            linhas = c.processar_noticias([base], [], AGORA)
        self.assertEqual([l["titulo"] for l in linhas], ["Dois"])


class TestNoticiasAntigas(Base):
    def setUp(self):
        super().setUp()
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS)

    def test_descarta_item_com_mais_de_7_dias_e_mantem_o_de_7(self):
        feed = rss(
            item_rss("Notícia velha de órgão oficial", "https://a.example/velha", "Mon, 12 Oct 2026 12:00:00 -0300"),
            item_rss("Notícia no limite dos sete dias", "https://a.example/limite", "Mon, 19 Oct 2026 12:00:00 -0300"),
            item_rss("Notícia do dia", "https://a.example/hoje"),
        )
        self.trocar(baixar_feed={"https://a.example/feed": feed, "https://b.example/feed": rss()}.__getitem__)
        b, s = self.banco()
        self.assertEqual(self.executar("noticias", b, AGORA), [])
        urls = sorted(linha["url"] for linha in s.posts("noticias")[0])
        self.assertEqual(urls, ["https://a.example/hoje", "https://a.example/limite"])

    def test_so_itens_antigos_nao_grava_nem_e_erro(self):
        feed = rss(item_rss("Notícia velha", "https://a.example/velha", "Mon, 12 Oct 2026 12:00:00 -0300"))
        self.trocar(baixar_feed={"https://a.example/feed": feed, "https://b.example/feed": rss()}.__getitem__)
        b, s = self.banco()
        self.assertEqual(self.executar("noticias", b, AGORA), [])
        self.assertEqual(s.posts("noticias"), [])


class TestMainNoticias(Base):
    def setUp(self):
        super().setUp()
        self.trocar(_agora=lambda: AGORA)

    def rodar(self, banco):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {"BRAPI_TOKEN": SEGREDO}), \
                mock.patch.object(c.Banco, "do_ambiente", return_value=banco), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = c.main(["--modo", "noticias", "--config", CONFIG_EXEMPLO])
        return rc, out.getvalue(), err.getvalue()

    def test_sai_com_0_quando_grava(self):
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS, baixar_feed=FEEDS.__getitem__)
        b, s = self.banco()
        rc, _, err = self.rodar(b)
        self.assertEqual((rc, err), (0, ""))
        self.assertEqual(len(s.posts("noticias")), 1)

    def test_sai_com_1_quando_todas_as_fontes_falham_sem_vazar_segredo(self):
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS,
                    baixar_feed=falha(f"HTTP 500 em x.example/feed?token={SEGREDO} Bearer {SEGREDO}"))
        b, _ = self.banco()
        rc, out, err = self.rodar(b)
        self.assertEqual(rc, 1)
        self.assertIn("Jornal A", err)
        self.assertNotIn(SEGREDO, out + err)

    def test_sai_com_1_quando_leu_noticias_e_nao_salvou(self):
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS, baixar_feed=FEEDS.__getitem__)
        rc, _, err = self.rodar(banco_com(SessaoFalhaPost(ATIVOS)))
        self.assertEqual(rc, 1)
        self.assertIn(c.SEM_NOTICIAS_SALVAS, err)

    def test_sai_com_0_com_uma_fonte_fora(self):
        self.trocar(FONTES_NOTICIAS=FONTES_FALSAS,
                    baixar_feed=lambda url: FEED_A if "a.example" in url else (_ for _ in ()).throw(RuntimeError("HTTP 500")))
        b, _ = self.banco()
        rc, _, err = self.rodar(b)
        self.assertEqual(rc, 0)
        self.assertIn("Jornal B", err)


class TestBriefingNosModos(Base):
    def briefing(self, s):
        linhas = [i for corpo in s.posts("indicadores") for i in corpo if i["chave"] == "briefing_mercado"]
        self.assertEqual(len(linhas), 1)
        return linhas[0]["valor"]

    def test_pregao_grava_briefing_com_texto_e_horario(self):
        b, s = self.banco()
        self.assertEqual(self.executar("pregao", b, PREGAO), [])
        valor = self.briefing(s)
        self.assertEqual(set(valor), {"texto", "as_of"})
        self.assertEqual(valor["as_of"], c.iso(PREGAO))
        # FIIA11: 53 cotas x R$ 0,10 = R$ 5,30, contra 7 x R$ 0,10 do FIIB11
        self.assertEqual(
            valor["texto"],
            "Ibovespa +0,8% e dólar R$ 130.000,00 (+0,8%). Maior destaque na sua carteira: FIIA11 (+1,1%).")

    def test_fechamento_tambem_grava_briefing(self):
        b, s = self.banco()
        self.executar("fechamento", b, FECHAMENTO)
        self.assertIn("Maior destaque", self.briefing(s)["texto"])

    def test_sem_dado_nenhum_substitui_texto_antigo_por_vazio(self):
        # um texto de ontem não pode continuar parecendo o de hoje
        self.falhas = {"FIIA11", "FIIB11"}
        self.trocar(yahoo_chart=lambda simbolo, rng="1y": (_ for _ in ()).throw(RuntimeError("HTTP 500 em y.example")))
        b, s = self.banco()
        self.executar("pregao", b, PREGAO)
        self.assertEqual(self.briefing(s)["texto"], "")

    def test_falha_no_briefing_nao_afeta_a_coleta(self):
        def quebra(indices, cotacoes, ativos):
            raise ValueError("falha qualquer")
        self.trocar(texto_mercado=quebra)
        b, s = self.banco()
        erros = self.executar("pregao", b, PREGAO)
        self.assertEqual(len(erros), 1)
        self.assertTrue(erros[0].startswith("briefing:"))
        self.assertNotIn("FIIA11", erros[0])
        self.assertEqual(len(s.posts("cotacoes")), 1)
        self.assertEqual([i["chave"] for corpo in s.posts("indicadores") for i in corpo], ["indices"])

    def test_falha_ao_salvar_briefing_vira_erro_isolado(self):
        class SessaoSemBriefing(Sessao):
            def post(self, url, **kw):
                if "briefing_mercado" in kw["data"].decode():
                    return Resp(500, texto="erro")
                return super().post(url, **kw)

        s = SessaoSemBriefing(ATIVOS)
        erros = self.executar("pregao", banco_com(s), PREGAO)
        self.assertEqual(len(erros), 1)
        self.assertTrue(erros[0].startswith("salvar_briefing:"))
        self.assertEqual(len(s.posts("cotacoes")), 1)


if __name__ == "__main__":
    unittest.main()
