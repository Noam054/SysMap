"""Questionnaire v5: servers that are turned off right now (standby), and the skipping process: steps that turn
servers off or on to move the system to another site. Mirrors frontend/tests/v5.test.mjs."""
import json
import unittest
from pathlib import Path

from app.core.normalize import normalize
from app.core.schema_check import check_definition
from app.core.validation import choice_options, validate_answers

DEF = json.loads((Path(__file__).parent.parent / "questionnaires" / "system-basic.v5.json").read_text())
Q = {q["id"]: q for q in DEF["questions"]}
SITE_ITEM = {q["id"]: q for q in Q["other_sites"]["item"]}
STEP = {q["id"]: q for q in Q["skipping"]["item"]}
OUT = Q["connections"]["item"][2]["options"][0]
OFF, ON = STEP["action"]["options"]

# ePO-like: Core runs in Ofek; the Core in Sapir is on standby. Skipping turns Ofek's off and Sapir's on.
GOOD = {
    "system_name": "ePO",
    "primary_site": "Ofek",
    "segments": [{"name": "Core", "subnet": "10.1.1.0/24"}, {"name": "App", "subnet": "10.1.2.0/24"}],
    "servers": [
        {"name": "core-1", "role": "app", "os": "Windows", "segment": "Core", "standby": False},
        {"name": "app-1", "role": "app", "os": "Windows", "segment": "App", "standby": False},
    ],
    "other_sites": [{
        "site": "Sapir",
        "segments": [{"name": "Core", "subnet": "10.2.1.0/24"}],
        "servers": [{"name": "core-1", "role": "app", "os": "Windows", "segment": "Core", "standby": True}],
    }],
    "dr_site": "Sapir",
    "connections": [
        {"from": ["App (Ofek)"], "to": ["Core (Ofek)", "Core (Sapir)"], "direction": OUT, "protocol": "HTTPS", "ports": "443"},
    ],
    "skipping": [
        {"action": OFF, "server": "core-1 (Ofek)", "note": "stop the service first"},
        {"action": ON, "server": "core-1 (Sapir)"},
    ],
}


def copy():
    return json.loads(json.dumps(GOOD))


class V5Tests(unittest.TestCase):
    def test_file_is_valid(self):
        self.assertEqual(check_definition(DEF), [])
        self.assertEqual(DEF["questions"][-1]["id"], "skipping")
        self.assertEqual(DEF["questions"][-2]["id"], "connections")
        self.assertEqual(Q["servers"]["item"][-1]["id"], "standby")
        self.assertEqual(SITE_ITEM["servers"]["item"][-1]["id"], "standby")
        self.assertEqual((OFF, ON), ("Turn off a server", "Turn on a server"))

    def test_answers_are_valid(self):
        self.assertEqual(validate_answers(DEF, GOOD), [])

    def test_a_step_picks_a_server_of_any_site(self):
        frames = [(Q["skipping"]["item"], GOOD["skipping"][0])]
        self.assertEqual(choice_options(STEP["server"], GOOD, frames), ["core-1 (Ofek)", "app-1 (Ofek)", "core-1 (Sapir)"])
        a = copy()
        a["skipping"][0]["server"] = "core-9 (Ofek)"
        self.assertTrue(validate_answers(DEF, a)[0].startswith("skipping[0].server: must be one of"))
        a = copy()
        del a["skipping"][1]["action"]
        self.assertEqual(validate_answers(DEF, a), ["skipping[1].action: is required"])

    def test_model(self):
        m = normalize(GOOD)
        self.assertEqual([s["key"] for s in m["servers"] if s.get("off")], ["core-1 (Sapir)"])
        self.assertEqual(m["skipping"], [
            {"action": "off", "server": "core-1 (Ofek)", "note": "stop the service first"},
            {"action": "on", "server": "core-1 (Sapir)", "note": ""},
        ])
        # every connection stays in the model, also the one to the server that is off
        self.assertEqual([(c["from"], c["to"]) for c in m["connections"]],
                         [("App (Ofek)", "Core (Ofek)"), ("App (Ofek)", "Core (Sapir)")])

    def test_a_step_with_a_server_that_is_gone_is_dropped(self):
        a = copy()
        a["skipping"].append({"action": ON, "server": "old-1 (Ofek)"})
        self.assertEqual(len(normalize(a)["skipping"]), 2)

    def test_older_answers_have_no_skipping(self):
        m = normalize({"system_name": "x", "primary_site": "Ofek", "servers": [{"name": "a", "standby": "yes"}]})
        self.assertEqual(m["skipping"], [])
        self.assertNotIn("off", m["servers"][0])  # only a real yes (true) turns a server off


if __name__ == "__main__":
    unittest.main()
