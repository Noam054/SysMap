"""Questionnaire v4: servers and segments with the same name in different sites, one list of connections
for all sites (between segments, several on each side), and the duplicate / copy-from-site flags."""
import json
import unittest
from pathlib import Path

from app.core.diagram import build_mermaid
from app.core.normalize import normalize
from app.core.schema_check import check_definition
from app.core.validation import choice_options, validate_answers

DEF = json.loads((Path(__file__).parent.parent / "questionnaires" / "system-basic.v4.json").read_text())
Q = {q["id"]: q for q in DEF["questions"]}
SITE_ITEM = {q["id"]: q for q in Q["other_sites"]["item"]}
CONN = {q["id"]: q for q in Q["connections"]["item"]}
OUT = CONN["direction"]["options"][0]

# Both sites have a segment called "DB" and a server called "db-1".
GOOD = {
    "system_name": "ePO",
    "primary_site": "Ofek",
    "segments": [{"name": "DB", "subnet": "10.1.1.0/24"}, {"name": "Core", "subnet": "10.1.2.0/24"}],
    "servers": [
        {"name": "core-1", "role": "app", "os": "Windows", "segment": "Core"},
        {"name": "db-1", "role": "database", "os": "Windows", "segment": "DB"},
    ],
    "other_sites": [{
        "site": "Sapir",
        "segments": [{"name": "DB", "subnet": "10.2.1.0/24"}],
        # pulled from Ofek with "Copy from another site": same name, other site
        "servers": [{"name": "db-1", "role": "database", "os": "Windows", "segment": "DB"}],
    }],
    "dr_site": "Sapir",
    "connections": [
        {"from": ["Core (Ofek)"], "to": ["DB (Ofek)", "DB (Sapir)"], "direction": OUT, "protocol": "TCP", "ports": "1433"},
        {"from": ["DB (Sapir)"], "to": ["DB (Ofek)"], "direction": OUT, "protocol": "repl", "ports": "5022"},
    ],
}


def copy():
    return json.loads(json.dumps(GOOD))


class V4Tests(unittest.TestCase):
    def test_file_is_valid(self):
        self.assertEqual(check_definition(DEF), [])
        self.assertTrue(Q["servers"]["duplicate"] and Q["servers"]["copy_from_site"])
        self.assertTrue(SITE_ITEM["servers"]["duplicate"] and SITE_ITEM["servers"]["copy_from_site"])

    def test_connections_are_one_list_at_the_end(self):
        self.assertEqual(DEF["questions"][-1]["id"], "connections")
        self.assertNotIn("connections", SITE_ITEM)
        self.assertTrue(CONN["from"]["multiple"] and CONN["to"]["multiple"])
        self.assertIs(Q["other_sites"]["collapsible"], False)
        self.assertEqual(Q["other_sites"]["add_label"], "Add new site")

    def test_same_names_in_two_sites_are_fine(self):
        self.assertEqual(validate_answers(DEF, GOOD), [])

    def test_server_names_differ_within_a_site(self):
        a = copy()
        a["servers"].append(dict(a["servers"][1], name="DB-1 "))  # a duplicate that kept the name
        self.assertEqual(validate_answers(DEF, a), ["servers[2].name: is already used in this list (see servers[1].name)"])
        a = copy()
        a["other_sites"][0]["servers"].append(dict(a["other_sites"][0]["servers"][0]))
        self.assertEqual(validate_answers(DEF, a),
                         ["other_sites[0].servers[1].name: is already used in this list (see other_sites[0].servers[0].name)"])

    def test_a_server_is_not_named_like_a_segment_of_its_site(self):
        a = copy()
        a["servers"][0]["name"] = "core"
        self.assertEqual(validate_answers(DEF, a), ["servers[0].name: is already used here (see the answers to segments.name)"])
        a = copy()
        a["other_sites"][0]["servers"][0]["name"] = "Core"  # Sapir has no "Core" segment
        self.assertEqual(validate_answers(DEF, a), [])

    def test_segment_names_differ_within_a_site(self):
        a = copy()
        a["segments"][1]["name"] = " db "
        self.assertEqual(validate_answers(DEF, a)[0], "segments[1].name: is already used in this list (see segments[0].name)")

    def test_connection_options_are_segments_of_every_site(self):
        frames = [(Q["connections"]["item"], GOOD["connections"][0])]
        self.assertEqual(choice_options(CONN["from"], GOOD, frames), ["DB (Ofek)", "Core (Ofek)", "DB (Sapir)"])
        # "To" leaves out what "From" picked
        self.assertEqual(choice_options(CONN["to"], GOOD, frames), ["DB (Ofek)", "DB (Sapir)", "All endpoints"])

    def test_several_picks_are_checked(self):
        a = copy()
        a["connections"][0]["to"] = ["DB (Ofek)", "DB (Ofek)"]
        self.assertEqual(validate_answers(DEF, a), ["connections[0].to: an option is picked twice"])
        a = copy()
        a["connections"][0]["to"] = ["Core (Ofek)"]  # also in "From"
        self.assertTrue(validate_answers(DEF, a)[0].startswith("connections[0].to: must be some of"))
        a = copy()
        a["connections"][0]["from"] = "Core (Ofek)"  # one text, not a list
        self.assertEqual(validate_answers(DEF, a), ["connections[0].from: must be a list of options"])
        a = copy()
        a["connections"][0]["from"] = []
        self.assertEqual(validate_answers(DEF, a), ["connections[0].from: is required"])

    def test_model_has_one_connection_per_pair(self):
        m = normalize(GOOD)
        self.assertEqual([g["key"] for g in m["segments"]], ["DB (Ofek)", "Core (Ofek)", "DB (Sapir)"])
        self.assertEqual([s["key"] for s in m["servers"]], ["core-1 (Ofek)", "db-1 (Ofek)", "db-1 (Sapir)"])
        self.assertEqual([(c["from"], c["to"], c["ports"]) for c in m["connections"]], [
            ("Core (Ofek)", "DB (Ofek)", "1433"), ("Core (Ofek)", "DB (Sapir)", "1433"), ("DB (Sapir)", "DB (Ofek)", "5022"),
        ])
        text = build_mermaid([m])
        self.assertIn("seg_ePO_DB__Sapir_ -->|repl 5022| seg_ePO_DB__Ofek_", text)
        self.assertIn("seg_ePO_Core__Ofek_ -->|TCP 1433| seg_ePO_DB__Sapir_", text)
        self.assertIn('srv_ePO_db_1__Sapir_["db-1 (database)"]', text)

    def test_schema_checks_for_new_fields(self):
        bad = json.loads(json.dumps(DEF))
        bad["questions"][0]["distinct"] = True  # system_name is not inside a list
        bad["questions"][1]["duplicate"] = True  # primary_site is not a list
        bad["questions"][1]["collapsible"] = False
        bad["questions"][0]["multiple"] = True  # a text question
        bad["questions"][-1]["item"][1]["options_from"][0]["label"] = "no value here"
        servers = next(q for q in bad["questions"] if q["id"] == "servers")
        servers["item"][1]["not_in"] = ["segments.name"]  # role is a choice
        problems = " ".join(check_definition(bad))
        self.assertIn("distinct only works on a question inside a list", problems)
        self.assertIn("duplicate must be true or false, on a list question", problems)
        self.assertIn("collapsible must be true or false, on a list question", problems)
        self.assertIn("multiple must be true or false, on a choice question", problems)
        self.assertIn("options_from label must be a text with {value}", problems)
        self.assertIn("not_in only works on text questions", problems)


if __name__ == "__main__":
    unittest.main()
