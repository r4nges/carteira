"""Confere que a RLS do Supabase bloqueia anon e usuários que não são o dono.

Uso: SUPABASE_URL, SUPABASE_SERVICE_KEY e SUPABASE_ANON_KEY no ambiente,
depois `python supabase/verificar_rls.py`. Chaves, senha e token nunca são impressos.
Testes (da raiz do repo): python -m unittest discover -s supabase -v
"""
import os
import secrets
import sys

import requests

TABELA = "configuracoes"
CHAVE_TESTE = "_teste"
CODIGO_ATIVO_TESTE = "_teste_rls"
TABELAS = ("dono", "ativos", "importacoes", "cotacoes", "tesouro",
           "indicadores", "snapshots", "noticias", "configuracoes")
TIMEOUT = 15


class ErroHttp(Exception):
    def __init__(self, mensagem, status=None):
        super().__init__(mensagem)
        self.status = status


def _cabecalhos(chave, extra=None, token=None):
    cab = {"apikey": chave}
    if token:
        cab["Authorization"] = f"Bearer {token}"
    elif chave.startswith("eyJ"):
        # Chaves legadas são JWT e vão também em Authorization; as novas (sb_...) só em apikey.
        cab["Authorization"] = f"Bearer {chave}"
    cab.update(extra or {})
    return cab


def _chamar(sessao, metodo, url, caminho, chave, token=None, **kwargs):
    extra = kwargs.pop("headers", None)
    resp = sessao.request(
        metodo, f"{url.rstrip('/')}{caminho}",
        headers=_cabecalhos(chave, extra, token), timeout=TIMEOUT, **kwargs,
    )
    if resp.status_code >= 400:
        raise ErroHttp(f"{metodo} {caminho} -> HTTP {resp.status_code}: {str(resp.text)[:200]}",
                       resp.status_code)
    return resp


def inserir_teste(sessao, url, chave_service):
    _chamar(sessao, "POST", url, f"/rest/v1/{TABELA}", chave_service,
            json={"chave": CHAVE_TESTE, "valor": {"teste": True}},
            headers={"Prefer": "resolution=merge-duplicates"})


def ler_linhas(sessao, url, chave, tabela=TABELA, token=None):
    return _chamar(sessao, "GET", url, f"/rest/v1/{tabela}", chave, token,
                   params={"select": "*"}).json()


def apagar_teste(sessao, url, chave_service):
    _chamar(sessao, "DELETE", url, f"/rest/v1/{TABELA}", chave_service,
            params={"chave": f"eq.{CHAVE_TESTE}"})


def apagar_ativo_teste(sessao, url, chave_service):
    _chamar(sessao, "DELETE", url, "/rest/v1/ativos", chave_service,
            params={"codigo": f"eq.{CODIGO_ATIVO_TESTE}"})


def criar_usuario_teste(sessao, url, chave_service):
    """Cria um usuário descartável confirmado. Devolve (id, email, senha)."""
    email = f"rls-teste-{secrets.token_hex(6)}@example.invalid"
    senha = secrets.token_urlsafe(24)
    resp = _chamar(sessao, "POST", url, "/auth/v1/admin/users", chave_service,
                   json={"email": email, "password": senha, "email_confirm": True})
    return resp.json()["id"], email, senha


def entrar(sessao, url, chave_anon, email, senha):
    resp = _chamar(sessao, "POST", url, "/auth/v1/token", chave_anon,
                   params={"grant_type": "password"},
                   json={"email": email, "password": senha})
    return resp.json()["access_token"]


def apagar_usuario(sessao, url, chave_service, id_usuario):
    _chamar(sessao, "DELETE", url, f"/auth/v1/admin/users/{id_usuario}", chave_service)


def checar_anon(sessao, url, chave_anon):
    vistas = ler_linhas(sessao, url, chave_anon)
    if vistas:
        return [f"a chave anon enxergou {len(vistas)} linha(s) em {TABELA}; "
                "a RLS não está bloqueando."]
    return []


def checar_service(sessao, url, chave_service):
    vistas = [l for l in ler_linhas(sessao, url, chave_service) if l.get("chave") == CHAVE_TESTE]
    if len(vistas) != 1:
        return [f"a service key deveria ver 1 linha de teste e viu {len(vistas)}."]
    return []


def checar_nao_dono(sessao, url, chave_anon, token):
    """Usuário logado que não é o dono: lê tudo vazio e não consegue inserir."""
    falhas = []
    for tabela in TABELAS:
        vistas = ler_linhas(sessao, url, chave_anon, tabela, token)
        if vistas:
            falhas.append(f"usuário que não é o dono enxergou {len(vistas)} linha(s) em {tabela}.")
    try:
        _chamar(sessao, "POST", url, "/rest/v1/ativos", chave_anon, token,
                json={"codigo": CODIGO_ATIVO_TESTE})
        falhas.append("usuário que não é o dono conseguiu inserir em ativos.")
    except ErroHttp as e:
        if e.status not in (401, 403):
            raise
    return falhas


def verificar(sessao, url, chave_service, chave_anon):
    """Devolve 0 se a RLS está correta, 1 caso contrário (mensagens em stderr)."""
    falhas = []
    id_usuario = None
    try:
        inserir_teste(sessao, url, chave_service)
        falhas += checar_anon(sessao, url, chave_anon)
        falhas += checar_service(sessao, url, chave_service)
        id_usuario, email, senha = criar_usuario_teste(sessao, url, chave_service)
        token = entrar(sessao, url, chave_anon, email, senha)
        falhas += checar_nao_dono(sessao, url, chave_anon, token)
    except (ErroHttp, requests.RequestException, ValueError, KeyError, TypeError,
            AttributeError) as e:
        falhas.append(str(e))
    finally:
        limpezas = [("linha de teste", lambda: apagar_teste(sessao, url, chave_service)),
                    ("ativo de teste", lambda: apagar_ativo_teste(sessao, url, chave_service))]
        if id_usuario:
            limpezas.append(("usuário de teste",
                             lambda: apagar_usuario(sessao, url, chave_service, id_usuario)))
        for nome, limpar in limpezas:
            try:
                limpar()
            except (ErroHttp, requests.RequestException) as e:
                falhas.append(f"não consegui apagar {nome}: {e}")
    if falhas:
        for f in falhas:
            print(f"FALHA: {f}", file=sys.stderr)
        return 1
    print("RLS ok")
    return 0


def main():
    nomes = ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY")
    faltando = [n for n in nomes if not os.environ.get(n)]
    if faltando:
        print("FALHA: defina no ambiente: " + ", ".join(faltando), file=sys.stderr)
        return 1
    url, service, anon = (os.environ[n] for n in nomes)
    return verificar(requests.Session(), url, service, anon)


if __name__ == "__main__":
    sys.exit(main())
