# Rodar da raiz do repo: python -m unittest discover -s supabase -v
import contextlib
import io
import unittest

import requests

import verificar_rls as v

URL = "https://exemplo.supabase.co"
SERVICE = "chave-service-falsa"
ANON = "chave-anon-falsa"
TOKEN = "token-falso-do-usuario"
ID_USUARIO = "id-usuario-falso"
LINHA = [{"chave": "_teste"}]


class Resp:
    def __init__(self, status=200, corpo=None):
        self.status_code = status
        self._corpo = [] if corpo is None else corpo
        self.text = str(self._corpo)

    def json(self):
        return self._corpo


class SessaoFalsa:
    """Simula PostgREST e Auth do Supabase.

    `respostas` sobrescreve o padrão, chaveado por (metodo, quem, alvo):
    quem = service | anon | user; alvo = nome da tabela ou auth_criar / auth_entrar / auth_apagar.
    O valor é uma Resp ou uma Exception (lançada).
    """

    def __init__(self, respostas=None):
        self.respostas = respostas or {}
        self.chamadas = []  # (metodo, quem, alvo)
        self.corpos = []

    def _padrao(self, metodo, quem, alvo):
        if alvo == "auth_criar":
            return Resp(corpo={"id": ID_USUARIO})
        if alvo == "auth_entrar":
            return Resp(corpo={"access_token": TOKEN})
        if alvo == "auth_apagar":
            return Resp(corpo={})
        if metodo == "GET":
            return Resp(corpo=LINHA if (quem == "service" and alvo == "configuracoes") else [])
        if metodo == "POST":
            return Resp(403, {"message": "violates row-level security"}) if quem == "user" \
                else Resp(201)
        return Resp(204)

    def request(self, metodo, url, headers=None, **kwargs):
        caminho = url[len(URL):]
        if caminho == "/auth/v1/admin/users":
            alvo = "auth_criar"
        elif caminho == "/auth/v1/token":
            alvo = "auth_entrar"
        elif caminho.startswith("/auth/v1/admin/users/"):
            alvo = "auth_apagar"
        else:
            alvo = caminho.rsplit("/", 1)[1]
        if headers.get("Authorization") == f"Bearer {TOKEN}":
            quem = "user"
        else:
            quem = "service" if headers["apikey"] == SERVICE else "anon"
        self.chamadas.append((metodo, quem, alvo))
        self.corpos.append(kwargs.get("json"))
        r = self.respostas.get((metodo, quem, alvo), self._padrao(metodo, quem, alvo))
        if isinstance(r, Exception):
            raise r
        return r


def rodar(sessao):
    saida, erro = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
        codigo = v.verificar(sessao, URL, SERVICE, ANON)
    return codigo, saida.getvalue(), erro.getvalue()


class VerificarRls(unittest.TestCase):
    def assertLimpou(self, s, usuario=True):
        self.assertIn(("DELETE", "service", "configuracoes"), s.chamadas)
        if usuario:
            self.assertIn(("DELETE", "service", "auth_apagar"), s.chamadas)

    def test_tudo_certo(self):
        s = SessaoFalsa()
        codigo, out, erro = rodar(s)
        self.assertEqual((codigo, erro), (0, ""))
        self.assertIn("RLS ok", out)
        self.assertLimpou(s)
        for tabela in v.TABELAS:
            self.assertIn(("GET", "user", tabela), s.chamadas)

    def test_anon_enxerga_linha(self):
        s = SessaoFalsa({("GET", "anon", "configuracoes"): Resp(corpo=LINHA)})
        codigo, out, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertNotIn("RLS ok", out)
        self.assertIn("anon", erro)
        self.assertLimpou(s)

    def test_service_nao_ve_linha(self):
        s = SessaoFalsa({("GET", "service", "configuracoes"): Resp(corpo=[])})
        codigo, _, _ = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertLimpou(s)

    def test_erro_http_da_service_key(self):
        s = SessaoFalsa({("POST", "service", "configuracoes"): Resp(404, {"message": "sem tabela"})})
        codigo, out, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertNotIn("RLS ok", out)
        self.assertIn("404", erro)
        self.assertLimpou(s, usuario=False)

    def test_excecao_de_rede_ainda_limpa(self):
        s = SessaoFalsa({("GET", "anon", "configuracoes"): requests.ConnectionError("rede")})
        codigo, _, _ = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertLimpou(s, usuario=False)

    def test_nao_dono_enxerga_linha(self):
        s = SessaoFalsa({("GET", "user", "ativos"): Resp(corpo=[{"codigo": "X"}])})
        codigo, out, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertNotIn("RLS ok", out)
        self.assertIn("ativos", erro)
        self.assertLimpou(s)

    def test_nao_dono_enxerga_tabela_dono(self):
        s = SessaoFalsa({("GET", "user", "dono"): Resp(corpo=[{"uid": "x"}])})
        codigo, _, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertIn("dono", erro)

    def test_nao_dono_consegue_inserir(self):
        s = SessaoFalsa({("POST", "user", "ativos"): Resp(201)})
        codigo, _, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertIn("inserir", erro)
        self.assertIn(("DELETE", "service", "ativos"), s.chamadas)
        self.assertLimpou(s)

    def test_usuario_apagado_quando_login_falha(self):
        s = SessaoFalsa({("POST", "anon", "auth_entrar"): Resp(400, {"msg": "ruim"})})
        codigo, _, _ = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertLimpou(s)

    def test_usuario_apagado_quando_nao_dono_falha(self):
        s = SessaoFalsa({("GET", "user", "noticias"): requests.ConnectionError("rede")})
        codigo, _, _ = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertLimpou(s)

    def test_falha_ao_apagar_linha_de_teste_da_exit_1(self):
        s = SessaoFalsa({("DELETE", "service", "configuracoes"): Resp(500, {"message": "x"})})
        codigo, out, erro = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertNotIn("RLS ok", out)
        self.assertIn("apagar", erro)
        self.assertLimpou(s)

    def test_falha_ao_apagar_usuario_da_exit_1(self):
        s = SessaoFalsa({("DELETE", "service", "auth_apagar"): Resp(500, {"message": "x"})})
        codigo, out, _ = rodar(s)
        self.assertEqual(codigo, 1)
        self.assertNotIn("RLS ok", out)

    def test_segredos_nao_sao_impressos(self):
        cenarios = [
            {("GET", "anon", "configuracoes"): Resp(corpo=LINHA)},  # caminho anon
            {("GET", "user", "ativos"): Resp(corpo=[{"codigo": "X"}]),  # caminho nao dono
             ("POST", "user", "ativos"): Resp(201)},
            {("POST", "anon", "auth_entrar"): Resp(400, {"msg": "ruim"})},
        ]
        for respostas in cenarios:
            s = SessaoFalsa(respostas)
            _, out, erro = rodar(s)
            senhas = [c["password"] for c in s.corpos if c and "password" in c]
            self.assertTrue(senhas or "anon" in erro)
            for segredo in (SERVICE, ANON, TOKEN, *senhas):
                self.assertNotIn(segredo, out + erro)

    def test_usuario_descartavel_usa_email_invalido_e_confirmado(self):
        s = SessaoFalsa()
        rodar(s)
        corpo = next(c for c in s.corpos if c and "email_confirm" in c)
        self.assertTrue(corpo["email_confirm"])
        self.assertTrue(corpo["email"].startswith("rls-teste-"))
        self.assertTrue(corpo["email"].endswith("@example.invalid"))


class Cabecalhos(unittest.TestCase):
    def test_bearer_so_para_chave_jwt(self):
        self.assertEqual(v._cabecalhos("eyJabc")["Authorization"], "Bearer eyJabc")
        self.assertNotIn("Authorization", v._cabecalhos("sb_secret_abc"))
        self.assertNotIn("Authorization", v._cabecalhos("sb_publishable_abc"))

    def test_token_do_usuario_tem_precedencia(self):
        cab = v._cabecalhos("sb_publishable_abc", token="eyJusuario")
        self.assertEqual(cab["apikey"], "sb_publishable_abc")
        self.assertEqual(cab["Authorization"], "Bearer eyJusuario")


if __name__ == "__main__":
    unittest.main()
