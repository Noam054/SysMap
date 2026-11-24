import copy
import json
import unittest
from pathlib import Path

from app.core.schema_check import check_definition, check_directory

QDIR = Path(__file__).parent.parent / "questionnaires"

OK = {
    "id": "demo",
    "version": 1,
    "title": "Demo",
    "questions": [
        {"id": "has_x", "type": "boolean", "label": "Has X?"},
        {"id": "x_where", "type": "text", "label": "Where?", "show_if": {"question": "has_x", "equals": True}},
        {"id": "kind", "type": "choice", "label": "Kind", "options": ["a", "b"]},
        {"id": "rows", "type": "list", "label": "Rows", "item": [{"id": "n", "type": "text", "label": "N"}]},
    ],
}


class SchemaCheckTests(unittest.TestCase):
    def test_shipped_questionnaires_are_valid(self):
        self.assertEqual(check_directory(QDIR), [])

    def test_ok_definition(self):
        self.assertEqual(check_definition(OK), [])

    def test_duplicate_and_bad_ids(self):
        d = copy.deepcopy(OK)
        d["questions"].append({"id": "kind", "type": "text", "label": "again"})
        d["questions"].append({"id": "Bad Id", "type": "text", "label": "x"})
        errors = " | ".join(check_definition(d))
        self.assertIn("duplicate id", errors)
        self.assertIn("lowercase letters", errors)

    def test_unknown_type_and_missing_label(self):
        d = copy.deepcopy(OK)
        d["questions"].append({"id": "q9", "type": "dropdown"})
        errors = " | ".join(check_definition(d))
        self.assertIn("type must be one of", errors)
        self.assertIn("label is required", errors)

    def test_choice_needs_options(self):
        d = copy.deepcopy(OK)
        d["questions"][2].pop("options")
        self.assertTrue(any("needs 'options'" in e for e in check_definition(d)))

    def test_list_needs_items_and_checks_them(self):
        d = copy.deepcopy(OK)
        d["questions"][3]["item"] = [{"id": "n", "type": "text"}]
        self.assertTrue(any(e.startswith("rows[].n") for e in check_definition(d)))
        d["questions"][3].pop("item")
        self.assertTrue(any("needs 'item'" in e for e in check_definition(d)))

    def test_show_if_must_point_backwards(self):
        d = copy.deepcopy(OK)
        d["questions"][0]["show_if"] = {"question": "kind", "equals": "a"}
        self.assertTrue(any("earlier question" in e for e in check_definition(d)))

    def test_show_if_value_matches_type(self):
        d = copy.deepcopy(OK)
        d["questions"][1]["show_if"] = {"question": "has_x", "equals": "yes"}
        self.assertTrue(any("true or false" in e for e in check_definition(d)))

    def test_number_min_max(self):
        d = copy.deepcopy(OK)
        d["questions"].append({"id": "n1", "type": "number", "label": "N", "min": 5, "max": 1})
        self.assertTrue(any("bigger than max" in e for e in check_definition(d)))

    def test_bad_top_level(self):
        self.assertTrue(check_definition({}))
        self.assertTrue(check_definition([]))

    def test_directory_checks_file_name_and_json(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "wrong-name.json").write_text(json.dumps(OK))
            (Path(tmp) / "broken.json").write_text("{not json")
            problems = dict(check_directory(tmp))
        self.assertIn("file name should be 'demo.v1.json'", problems["wrong-name.json"][0])
        self.assertIn("not valid JSON", problems["broken.json"][0])


if __name__ == "__main__":
    unittest.main()
