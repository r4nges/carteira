import unittest
from datetime import date

import calendario as cal


class TestesCalendario(unittest.TestCase):
    def test_feriados_2026(self):
        esperados = [
            date(2026, 1, 1),
            date(2026, 2, 16),  # Carnaval (segunda)
            date(2026, 2, 17),  # Carnaval (terça)
            date(2026, 4, 3),   # Sexta-feira Santa
            date(2026, 4, 21),
            date(2026, 5, 1),
            date(2026, 6, 4),   # Corpus Christi
            date(2026, 9, 7),
            date(2026, 10, 12),
            date(2026, 11, 2),
            date(2026, 11, 15),
            date(2026, 11, 20),
            date(2026, 12, 24),
            date(2026, 12, 25),
            date(2026, 12, 31),
        ]
        feriados = cal.feriados_b3(2026)
        for d in esperados:
            self.assertIn(d, feriados, d.isoformat())

    def test_pascoa(self):
        self.assertEqual(cal.pascoa(2026), date(2026, 4, 5))
        self.assertEqual(cal.pascoa(2024), date(2024, 3, 31))

    def test_consciencia_negra_so_desde_2024(self):
        self.assertNotIn(date(2023, 11, 20), cal.feriados_b3(2023))
        self.assertIn(date(2024, 11, 20), cal.feriados_b3(2024))

    def test_eh_pregao(self):
        self.assertFalse(cal.eh_pregao(date(2026, 10, 12)))  # feriado
        self.assertTrue(cal.eh_pregao(date(2026, 10, 13)))
        self.assertFalse(cal.eh_pregao(date(2026, 10, 17)))  # sábado
        self.assertFalse(cal.eh_pregao(date(2026, 10, 18)))  # domingo

    def test_ultimo_pregao_ate(self):
        self.assertEqual(cal.ultimo_pregao_ate(date(2026, 10, 13)), date(2026, 10, 13))
        self.assertEqual(cal.ultimo_pregao_ate(date(2026, 10, 12)), date(2026, 10, 9))
        self.assertEqual(cal.ultimo_pregao_ate(date(2026, 10, 18)), date(2026, 10, 16))
        # virada de ano: 31/12 e 01/01 feriados, 30/12/2026 é quarta
        self.assertEqual(cal.ultimo_pregao_ate(date(2027, 1, 1)), date(2026, 12, 30))


if __name__ == "__main__":
    unittest.main()
