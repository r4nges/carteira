import unittest

from noticias.briefing import texto_mercado

IBOV = {"valor": 128000.0, "variacao_dia_pct": -1.23, "as_of": "2026-10-23T17:00:00-03:00",
        "defasado": False, "fonte": "yahoo"}
DOLAR = {"valor": 5.6, "variacao_dia_pct": 0.8, "as_of": "2026-10-23T17:00:00-03:00",
         "defasado": False, "fonte": "yahoo"}
INDICES = {"IBOV": IBOV, "USDBRL": DOLAR, "EWZ": {**IBOV, "variacao_dia_pct": 9.9}}

ATIVOS = [
    {"codigo": "ACAO4", "tipo": "Ação", "quantidade": 100},
    {"codigo": "FIIA11", "tipo": "FII", "quantidade": 53},
    {"codigo": "FIIB11", "tipo": "FII", "quantidade": 7},
    {"codigo": "CDB FICTICIO", "tipo": "Renda fixa", "quantidade": None},
]


def cot(codigo, preco, prev_close, **kw):
    var = round((preco / prev_close - 1) * 100, 2)
    return {"codigo": codigo, "preco": preco, "prev_close": prev_close, "variacao_dia_pct": var,
            "defasado": False, **kw}


# ACAO4: 100 x (9,79 - 10,00) = -21,00 ; FIIA11: 53 x 0,10 = +5,30 ; FIIB11: 7 x 0,50 = +3,50
COTACOES = [cot("ACAO4", 9.79, 10.0), cot("FIIA11", 8.92, 8.82), cot("FIIB11", 74.63, 74.13)]


class TestTextoMercado(unittest.TestCase):
    def test_texto_completo_em_pt_br(self):
        self.assertEqual(
            texto_mercado(INDICES, COTACOES, ATIVOS),
            "Ibovespa −1,2% e dólar R$ 5,60 (+0,8%). Maior destaque na sua carteira: ACAO4 (−2,1%).")

    def test_sem_dolar_so_ibovespa(self):
        self.assertEqual(
            texto_mercado({"IBOV": IBOV}, COTACOES, ATIVOS),
            "Ibovespa −1,2%. Maior destaque na sua carteira: ACAO4 (−2,1%).")

    def test_sem_ibovespa_so_dolar(self):
        self.assertEqual(
            texto_mercado({"USDBRL": DOLAR}, [], ATIVOS),
            "Dólar R$ 5,60 (+0,8%).")

    def test_sem_cotacoes_omite_destaque(self):
        self.assertEqual(texto_mercado(INDICES, [], ATIVOS), "Ibovespa −1,2% e dólar R$ 5,60 (+0,8%).")

    def test_so_destaque_sem_indices(self):
        self.assertEqual(texto_mercado({}, COTACOES, ATIVOS),
                         "Maior destaque na sua carteira: ACAO4 (−2,1%).")

    def test_tudo_vazio_devolve_string_vazia(self):
        self.assertEqual(texto_mercado({}, [], []), "")
        self.assertEqual(texto_mercado({}, COTACOES, []), "")  # sem quantidade não há destaque

    def test_indice_defasado_leva_a_data(self):
        defasado = {**IBOV, "defasado": True, "as_of": "2026-10-22T17:00:00-03:00"}
        self.assertEqual(
            texto_mercado({"IBOV": defasado, "USDBRL": DOLAR}, [], ATIVOS),
            "Ibovespa −1,2% (dado de 22/10) e dólar R$ 5,60 (+0,8%).")

    def test_dolar_defasado_leva_a_data(self):
        defasado = {**DOLAR, "defasado": True, "as_of": "2026-10-22T17:00:00-03:00"}
        self.assertEqual(texto_mercado({"USDBRL": defasado}, [], []),
                         "Dólar R$ 5,60 (+0,8%) (dado de 22/10).")

    def test_defasado_sem_data_nao_inventa_dia(self):
        defasado = {**IBOV, "defasado": True, "as_of": None}
        self.assertEqual(texto_mercado({"IBOV": defasado}, [], []), "Ibovespa −1,2% (dado defasado).")

    def test_destaque_e_o_maior_em_reais_nao_em_percentual(self):
        # FIIB11 cai 5% mas são 7 cotas (-R$ 35,00); FIIA11 sobe 11% com 53 cotas (+R$ 53,00)
        cotacoes = [cot("FIIB11", 95.0, 100.0), cot("FIIA11", 10.0, 9.0)]
        self.assertEqual(texto_mercado({}, cotacoes, ATIVOS),
                         "Maior destaque na sua carteira: FIIA11 (+11,1%).")

    def test_destaque_ignora_linha_com_erro(self):
        falha = {"codigo": "ACAO4", "erro": "brapi: HTTP 500", "defasado": True}
        self.assertEqual(texto_mercado({}, [falha, cot("FIIB11", 74.63, 74.13)], ATIVOS),
                         "Maior destaque na sua carteira: FIIB11 (+0,7%).")
        self.assertEqual(texto_mercado({}, [falha], ATIVOS), "")

    def test_destaque_ignora_cotacao_defasada_ou_sem_prev_close(self):
        velha = cot("ACAO4", 9.79, 10.0, defasado=True)
        sem_prev = {"codigo": "FIIA11", "preco": 8.92, "prev_close": None,
                    "variacao_dia_pct": None, "defasado": False}
        self.assertEqual(texto_mercado({}, [velha, sem_prev], ATIVOS), "")

    def test_destaque_ignora_ativo_fora_da_carteira(self):
        self.assertEqual(texto_mercado({}, [cot("ZZZZ3", 5.0, 10.0)], ATIVOS), "")

    def test_quantidade_nula_ou_zero_nao_vira_destaque(self):
        ativos = [{"codigo": "ACAO4", "quantidade": None}, {"codigo": "FIIA11", "quantidade": 0}]
        self.assertEqual(texto_mercado({}, COTACOES, ativos), "")

    def test_variacao_zero_sem_sinal(self):
        parado = {**IBOV, "variacao_dia_pct": 0.0}
        self.assertEqual(texto_mercado({"IBOV": parado}, [], []), "Ibovespa 0,0%.")
        quase = {**IBOV, "variacao_dia_pct": -0.04}
        self.assertEqual(texto_mercado({"IBOV": quase}, [], []), "Ibovespa 0,0%.")

    def test_indice_sem_variacao_ou_valor_e_omitido(self):
        self.assertEqual(texto_mercado({"IBOV": {**IBOV, "variacao_dia_pct": None}}, [], []), "")
        self.assertEqual(texto_mercado({"USDBRL": {**DOLAR, "valor": None}}, [], []), "")
        sem_var = {**DOLAR, "variacao_dia_pct": None}
        self.assertEqual(texto_mercado({"USDBRL": sem_var}, [], []), "Dólar R$ 5,60.")

    def test_milhar_com_ponto(self):
        self.assertEqual(texto_mercado({"USDBRL": {**DOLAR, "valor": 1234.5}}, [], []),
                         "Dólar R$ 1.234,50 (+0,8%).")


if __name__ == "__main__":
    unittest.main()
