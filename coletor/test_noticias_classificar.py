import unittest
from datetime import datetime, timedelta, timezone

from noticias import classificar

AGORA = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
ATIVOS = [
    {"codigo": "ACAO4", "tipo": "Ação", "produto": "ACAO4 - ACME S.A."},
    {"codigo": "FIIA11", "tipo": "FII", "produto": "FIIA11 - FUNDO DE INVESTIMENTO IMOBILIARIO FIIA"},
    {"codigo": "BANCO3", "tipo": "Ação", "produto": "BANCO3 - BANCO BRASIL S.A."},
]


def noticia(titulo, fonte="G1", peso=0.8, horas_atras=1, lide="", **extra):
    return {"titulo": titulo, "url": "https://x.example/" + titulo[:8], "lide": lide, "fonte": fonte,
            "tema": "economia", "peso": peso, "publicado_em": AGORA - timedelta(hours=horas_atras), **extra}


class TestesNormalizar(unittest.TestCase):
    def test_tira_acento_e_baixa_caixa(self):
        self.assertEqual(classificar.normalizar("Acmé Ação À VISTA"), "acme acao a vista")


class TestesAliases(unittest.TestCase):
    def test_codigo_e_nome_curto(self):
        self.assertEqual(classificar.aliases(ATIVOS[0]), ["acao4", "acme"])

    def test_tira_sufixos_societarios(self):
        for produto in ("ACAO4 - ACME S.A.", "ACAO4 - ACME SA", "ACAO4 - ACME LTDA", "ACAO4 - ACME PARTICIPACOES S.A."):
            with self.subTest(produto=produto):
                self.assertEqual(classificar.aliases({"codigo": "ACAO4", "produto": produto}), ["acao4", "acme"])

    def test_nome_de_fundo_sem_o_genero(self):
        self.assertEqual(classificar.aliases(ATIVOS[1]), ["fiia11", "fiia"])
        self.assertEqual(classificar.aliases({"codigo": "FIIB11", "produto": "FIIB11 - FUNDO DE INVESTIMENTO IMOBILIARIO"}),
                         ["fiib11"])

    def test_nome_generico_ou_curto_nao_vira_alias(self):
        self.assertEqual(classificar.aliases(ATIVOS[2]), ["banco3"])  # "banco brasil" é só palavra comum
        self.assertEqual(classificar.aliases({"codigo": "ABC3", "produto": "ABC3 - ABC S.A."}), ["abc3"])  # curto demais

    def test_nome_composto_vira_frase(self):
        self.assertEqual(classificar.aliases({"codigo": "ZETA3", "produto": "ZETA3 - ZETA ALFA S.A."}),
                         ["zeta3", "zeta alfa"])

    def test_sem_produto(self):
        self.assertEqual(classificar.aliases({"codigo": "ACAO4", "produto": None}), ["acao4"])
        self.assertEqual(classificar.aliases({"codigo": "ACAO4"}), ["acao4"])


class TestesMarcarAtivos(unittest.TestCase):
    def test_codigo_casa_no_titulo(self):
        self.assertEqual(classificar.marcar_ativos(noticia("ACAO4 sobe 3% na bolsa"), ATIVOS), ["ACAO4"])

    def test_codigo_nao_casa_dentro_de_outro(self):
        self.assertEqual(classificar.marcar_ativos(noticia("ACAO44 sobe 3%"), ATIVOS), [])
        self.assertEqual(classificar.marcar_ativos(noticia("XACAO4 sobe"), ATIVOS), [])

    def test_alias_do_nome_casa_sem_depender_de_acento(self):
        self.assertEqual(classificar.marcar_ativos(noticia("ACME anuncia dividendos"), ATIVOS), ["ACAO4"])
        self.assertEqual(classificar.marcar_ativos(noticia("Acmé anuncia dividendos"), ATIVOS), ["ACAO4"])
        self.assertEqual(classificar.marcar_ativos(noticia("Acmes anuncia dividendos"), ATIVOS), [])

    def test_casa_no_lide(self):
        n = noticia("Mercado hoje", lide="O fundo FIIA11 pagou rendimentos.")
        self.assertEqual(classificar.marcar_ativos(n, ATIVOS), ["FIIA11"])

    def test_varios_sem_repetir_e_ordem_da_carteira(self):
        n = noticia("FIIA11 e ACAO4 sobem; ACAO4 lidera", lide="Acme também")
        self.assertEqual(classificar.marcar_ativos(n, ATIVOS), ["ACAO4", "FIIA11"])

    def test_palavra_comum_nao_marca(self):
        self.assertEqual(classificar.marcar_ativos(noticia("Banco do Brasil anuncia lucro"), ATIVOS), [])

    def test_sem_ativos(self):
        self.assertEqual(classificar.marcar_ativos(noticia("ACAO4 sobe"), []), [])


class TestesTagsMacro(unittest.TestCase):
    def test_copom_selic_e_juros(self):
        self.assertEqual(classificar.tags_macro(noticia("Copom mantém Selic")), ["juros"])

    def test_varias_tags(self):
        n = noticia("Dólar fecha em alta após eleição")
        self.assertEqual(classificar.tags_macro(n), ["cambio", "eleicoes"])

    def test_outras_tags(self):
        self.assertEqual(classificar.tags_macro(noticia("Ibovespa fecha em queda")), ["bolsa"])
        self.assertEqual(classificar.tags_macro(noticia("Petróleo Brent recua")), ["petroleo"])
        self.assertEqual(classificar.tags_macro(noticia("Governo revisa meta fiscal")), ["fiscal"])

    def test_lide_conta(self):
        self.assertEqual(classificar.tags_macro(noticia("Reunião hoje", lide="Selic em debate")), ["juros"])

    def test_sem_tag(self):
        self.assertEqual(classificar.tags_macro(noticia("Time vence o clássico")), [])

    def test_palavra_dentro_de_outra_nao_casa(self):
        self.assertEqual(classificar.tags_macro(noticia("Bolsão de vagas abre")), [])


class TestesAgrupar(unittest.TestCase):
    def test_lista_vazia_e_item_unico(self):
        self.assertEqual(classificar.agrupar([]), [])
        r = classificar.agrupar([noticia("Dólar sobe")])
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["tambem_em"], [])
        self.assertTrue(r[0]["grupo_id"])

    def test_mesma_noticia_em_duas_fontes(self):
        a = noticia("Dólar fecha em alta após eleição", fonte="G1", peso=0.8, horas_atras=2)
        b = noticia("Dólar sobe após eleição", fonte="Folha", peso=0.7, horas_atras=1)
        r = classificar.agrupar([b, a])
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["fonte"], "G1")
        self.assertEqual(r[0]["tambem_em"], ["Folha"])

    def test_representante_e_o_de_maior_peso_depois_o_mais_antigo(self):
        a = noticia("Dólar sobe após eleição", fonte="A", peso=0.7, horas_atras=1)
        b = noticia("Dólar sobe após eleição", fonte="B", peso=0.7, horas_atras=3)
        c = noticia("Dólar sobe após eleição", fonte="C", peso=0.9, horas_atras=0)
        self.assertEqual(classificar.agrupar([a, b, c])[0]["fonte"], "C")
        r = classificar.agrupar([a, b])
        self.assertEqual(r[0]["fonte"], "B")
        self.assertEqual(r[0]["tambem_em"], ["A"])

    def test_distancia_maior_que_24h_nao_agrupa(self):
        a = noticia("Dólar sobe após eleição", fonte="G1", horas_atras=1)
        b = noticia("Dólar sobe após eleição", fonte="Folha", horas_atras=26)
        self.assertEqual(len(classificar.agrupar([a, b])), 2)

    def test_mesma_fonte_nao_agrupa(self):
        a = noticia("Dólar sobe após eleição", fonte="G1", horas_atras=1)
        b = noticia("Dólar sobe após eleição", fonte="G1", horas_atras=2)
        self.assertEqual(len(classificar.agrupar([a, b])), 2)

    def test_titulos_diferentes_nao_agrupam(self):
        a = noticia("Dólar sobe após eleição", fonte="G1")
        b = noticia("Copom mantém Selic", fonte="Folha")
        self.assertEqual(len(classificar.agrupar([a, b])), 2)

    def test_direcao_oposta_nao_agrupa(self):
        a = noticia("Dólar sobe após eleição", fonte="G1")
        b = noticia("Dólar cai após eleição", fonte="Folha")
        self.assertEqual(len(classificar.agrupar([a, b])), 2)

    def test_so_stopwords_nao_agrupa_nem_quebra(self):
        a = noticia("O que é isso", fonte="G1")
        b = noticia("O que é isso", fonte="Folha")
        self.assertEqual(len(classificar.agrupar([a, b])), 2)

    def test_tres_fontes_e_nao_altera_a_entrada(self):
        a = noticia("Dólar sobe após eleição", fonte="G1", peso=0.9)
        b = noticia("Dólar sobe após eleição", fonte="Folha")
        c = noticia("Dólar sobe após eleição", fonte="Valor", peso=0.7)
        r = classificar.agrupar([a, b, c])
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0]["tambem_em"], ["Folha", "Valor"])
        self.assertNotIn("grupo_id", a)

    def test_grupo_id_estavel_e_distinto(self):
        a = noticia("Dólar sobe após eleição", fonte="G1")
        b = noticia("Copom mantém Selic", fonte="G1")
        r1 = classificar.agrupar([a, b])
        r2 = classificar.agrupar([b, a])
        self.assertEqual({x["titulo"]: x["grupo_id"] for x in r1}, {x["titulo"]: x["grupo_id"] for x in r2})
        self.assertNotEqual(r1[0]["grupo_id"], r1[1]["grupo_id"])

    def test_mantem_ordem_de_entrada(self):
        a = noticia("Copom mantém Selic", fonte="G1")
        b = noticia("Dólar sobe após eleição", fonte="G1")
        self.assertEqual([x["titulo"] for x in classificar.agrupar([a, b])], [a["titulo"], b["titulo"]])


class TestesPontuar(unittest.TestCase):
    def test_formula_basica(self):
        n = noticia("Algo", peso=0.8, horas_atras=12)
        self.assertAlmostEqual(classificar.pontuar(n, AGORA), 0.8 * 0.5)

    def test_cita_ativo_e_tags(self):
        n = noticia("Algo", peso=0.8, horas_atras=0, ativos=["ACAO4"], tags=["juros", "cambio"])
        self.assertAlmostEqual(classificar.pontuar(n, AGORA), 0.8 * (1 + 2 + 1.0))

    def test_recente_com_ativo_vence_antigo_sem_ativo(self):
        novo = noticia("Algo", horas_atras=1, ativos=["ACAO4"])
        velho = noticia("Algo", horas_atras=25, ativos=[])
        self.assertGreater(classificar.pontuar(novo, AGORA), classificar.pontuar(velho, AGORA))

    def test_sem_chave_tags_calcula_pelo_texto(self):
        n = noticia("Copom mantém Selic", peso=1.0, horas_atras=0)
        self.assertAlmostEqual(classificar.pontuar(n, AGORA), 1.5)

    def test_data_levemente_no_futuro_nao_infla(self):
        n = noticia("Algo", peso=0.8, horas_atras=-1)
        self.assertAlmostEqual(classificar.pontuar(n, AGORA), 0.8)


if __name__ == "__main__":
    unittest.main()
