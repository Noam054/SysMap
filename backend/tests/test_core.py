import json
import unittest
from pathlib import Path

from app.core.validation import validate_answers
from app.core.normalize import normalize
from app.core.diagram import build_mermaid

DEF = json.loads((Path(__file__).parent.parent / "questionnaires" / "system-basic.v1.json").read_text())

GOOD = {
    "system_name": "Billing",
    "server_count": 2,
    "servers": [
        {"name": "bill-app-1", "site": "Haifa", "role": "app", "os": "RHEL 9"},
        {"name": "bill-db-1", "site": "Haifa", "role": "database"},
    ],
    "depends_on": [{"system": "Auth", "protocol": "LDAPS/636"}],
    "has_dr": True,
    "dr_site": "Beer Sheva",
}


class CoreTests(unittest.TestCase):
    def test_valid_answers(self):
        self.assertEqual(validate_answers(DEF, GOOD), [])

    def test_missing_required(self):
        errors = validate_answers(DEF, {"server_count": 1})
        self.assertIn("system_name: is required", errors)

    def test_conditional_question(self):
        a = dict(GOOD, has_dr=False)
        a.pop("dr_site")
        self.assertEqual(validate_answers(DEF, a), [])
        b = dict(GOOD)
        b.pop("dr_site")
        self.assertIn("dr_site: is required", validate_answers(DEF, b))

    def test_list_item_errors(self):
        a = dict(GOOD, servers=[{"name": "x"}])
        self.assertIn("servers[0].site: is required", validate_answers(DEF, a))

    def test_wrong_types(self):
        a = dict(GOOD, server_count="two")
        self.assertIn("server_count: must be a number", validate_answers(DEF, a))

    def test_normalize(self):
        n = normalize(GOOD)
        self.assertEqual(n["system"], "Billing")
        self.assertEqual(n["sites"], ["Beer Sheva", "Haifa"])
        self.assertEqual(n["links"], [{"to": "Auth", "protocol": "LDAPS/636"}])

    def test_diagram(self):
        out = build_mermaid([normalize(GOOD)])
        self.assertTrue(out.startswith("flowchart LR"))
        self.assertIn("Site: Haifa", out)
        self.assertIn("Auth (not described yet)", out)


if __name__ == "__main__":
    unittest.main()
