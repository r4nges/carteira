"""Cliente mínimo do Supabase (PostgREST) usado pelo coletor. Sem SDK."""
import json
import os
from datetime import datetime, timedelta, timezone

import requests

TIMEOUT = 30


class Banco:
    def __init__(self, url, chave, sessao=requests):
        self.url = url.rstrip("/")
        self._chave = chave
        self.sessao = sessao

    @classmethod
    def do_ambiente(cls):
        valores = {}
        for nome in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
            valor = os.environ.get(nome)
            if not valor:
                raise RuntimeError(f"variável de ambiente ausente: {nome}")
            valores[nome] = valor
        return cls(valores["SUPABASE_URL"], valores["SUPABASE_SERVICE_KEY"])

    def _cabecalhos(self, extra=None):
        h = {"apikey": self._chave}
        # Chaves legadas são JWT e também vão em Authorization; as novas
        # (sb_secret_...) vão só em apikey.
        if self._chave.startswith("eyJ"):
            h["Authorization"] = f"Bearer {self._chave}"
        h.update(extra or {})
        return h

    def _checar(self, resp, metodo, tabela):
        if resp.status_code >= 400:
            corpo = (resp.text or "")[:200]
            raise RuntimeError(
                f"{metodo} {tabela}: HTTP {resp.status_code}: {corpo}")
        return resp

    def _url(self, tabela, query=""):
        return f"{self.url}/rest/v1/{tabela}{query}"

    def ativos(self):
        resp = self.sessao.get(self._url("ativos", "?select=*"),
                               headers=self._cabecalhos(), timeout=TIMEOUT)
        return self._checar(resp, "GET", "ativos").json()

    def upsert(self, tabela, linhas, conflito):
        # O PostgREST usa a união das chaves do lote: uma linha sem "preco"
        # misturada com linhas completas gravaria NULL no preço existente.
        # Por isso, um POST por conjunto de chaves (na ordem da 1ª aparição).
        grupos = {}
        for linha in linhas:
            grupos.setdefault(frozenset(linha), []).append(linha)
        for grupo in grupos.values():
            resp = self.sessao.post(
                self._url(tabela, f"?on_conflict={conflito}"),
                headers=self._cabecalhos({
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates",
                }),
                data=json.dumps(grupo, ensure_ascii=False).encode("utf-8"),
                timeout=TIMEOUT,
            )
            self._checar(resp, "POST", tabela)

    def salvar_cotacoes(self, linhas):
        self.upsert("cotacoes", linhas, "codigo")

    def salvar_tesouro(self, linhas):
        self.upsert("tesouro", linhas, "codigo")

    def salvar_indicador(self, chave, valor):
        self.upsert("indicadores", [{"chave": chave, "valor": valor}], "chave")

    def salvar_snapshot(self, snap):
        self.upsert("snapshots", [snap], "data")

    def salvar_noticias(self, itens):
        self.upsert("noticias", itens, "id")

    def limpar_noticias(self, dias=7):
        corte = datetime.now(timezone.utc) - timedelta(days=dias)
        iso = corte.strftime("%Y-%m-%dT%H:%M:%SZ")
        resp = self.sessao.delete(
            self._url("noticias", f"?coletado_em=lt.{iso}"),
            headers=self._cabecalhos(), timeout=TIMEOUT)
        self._checar(resp, "DELETE", "noticias")
