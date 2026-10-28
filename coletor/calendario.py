"""Calendário de pregões da B3 (somente biblioteca padrão)."""
from __future__ import annotations

from datetime import date, timedelta


def pascoa(ano: int) -> date:
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)."""
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


def feriados_b3(ano: int) -> set[date]:
    """Feriados com B3 fechada no ano. Os que caem em fim de semana ficam no conjunto."""
    p = pascoa(ano)
    feriados = {
        date(ano, 1, 1),
        p - timedelta(days=48),  # Carnaval (segunda)
        p - timedelta(days=47),  # Carnaval (terça)
        p - timedelta(days=2),   # Sexta-feira Santa
        date(ano, 4, 21),        # Tiradentes
        date(ano, 5, 1),
        p + timedelta(days=60),  # Corpus Christi
        date(ano, 9, 7),
        date(ano, 10, 12),
        date(ano, 11, 2),
        date(ano, 11, 15),
        date(ano, 12, 24),
        date(ano, 12, 25),
        date(ano, 12, 31),
    }
    if ano >= 2024:
        feriados.add(date(ano, 11, 20))  # Consciência Negra (nacional desde 2024)
    return feriados


def eh_pregao(d: date) -> bool:
    return d.weekday() < 5 and d not in feriados_b3(d.year)


def ultimo_pregao_ate(d: date) -> date:
    """Último dia de pregão <= d."""
    while not eh_pregao(d):
        d -= timedelta(days=1)
    return d
