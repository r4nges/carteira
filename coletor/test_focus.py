import unittest

import coletor as c


class FocusAnualTest(unittest.TestCase):
    def test_espaco_vai_como_percent20(self):
        visto = {}

        class Resp:
            @staticmethod
            def json():
                return {"value": [{"Data": "2026-10-23", "Mediana": 5.19}]}

        def get_falso(url, **kw):
            visto.update(kw)
            return Resp()

        antes = c.get
        c.get = get_falso
        try:
            r = c.focus_anual("IPCA", 2026)
        finally:
            c.get = antes
        params = visto["params"]
        self.assertIsInstance(params, str)
        self.assertNotIn("+", params)
        self.assertIn("Indicador%20eq%20'IPCA'%20and%20DataReferencia%20eq%20'2026'", params)
        self.assertIn("$orderby=Data%20desc", params)
        self.assertEqual(r, {"data": "2026-10-23", "mediana": 5.19})


if __name__ == "__main__":
    unittest.main()
