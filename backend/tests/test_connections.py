"""Questionnaire v2: sites, server-to-server connections, options_from, validation, model and Mermaid."""
import json
import unittest
from pathlib import Path

from app.core.diagram import build_mermaid
from app.core.normalize import ENDPOINTS, NO_DR, normalize
from app.core.schema_check import check_definition
from app.core.validation import choice_options, validate_answers

DEF = json.loads((Path(__file__).parent.parent / "questionnaires" / "system-basic.v2.json").read_text())
SERVERS = next(q for q in DEF["questions"] if q["id"] == "servers")
CONN = next(q for q in SERVERS["item"] if q["id"] == "connections")
OUT, IN, BOTH = CONN["item"][1]["options"]

GOOD = {
    "primary_site": "Ofek",
    "system_name": "ePO",
    "servers": [
        {"name": "epo-app-1", "role": "app", "os": "Linux", "has_connections": True, "connections": [
            {"to": "epo-db-1", "direction": OUT, "protocol": "MSSQL", "ports": "1433"},
            {"to": ENDPOINTS, "direction": IN, "protocol": "HTTPS", "ports": "443, 8443"},
            {"to": ENDPOINTS, "direction": BOTH, "protocol": "Agent", "ports": "8081"},
        ]},
        # The same MSSQL connection described from the database's side: must count once.
        {"name": "epo-db-1", "role": "database", "os": "Windows", "has_connections": True, "connections": [
            {"to": "epo-app-1", "direction": IN, "protocol": "MSSQL", "ports": "1433"},
        ]},
    ],
}


def _with_conn(conn):
    a = json.loads(json.dumps(GOOD))
    a["servers"][0]["connections"] = [conn]
    return a


class ConnectionTests(unittest.TestCase):
    def test_v2_file_is_valid(self):
        self.assertEqual(check_definition(DEF), [])

    def test_valid_answers(self):
        self.assertEqual(validate_answers(DEF, GOOD), [])

    def test_options_come_from_server_names(self):
        q = CONN["item"][0]
        self.assertEqual(choice_options(q, GOOD), ["epo-app-1", "epo-db-1", ENDPOINTS])
        self.assertEqual(choice_options(q, {}), [ENDPOINTS])

    def test_unknown_server_is_rejected(self):
        errors = validate_answers(DEF, _with_conn({"to": "nope", "direction": OUT, "protocol": "x", "ports": "1"}))
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("servers[0].connections[0].to: must be one of"))

    def test_direction_protocol_and_ports_required(self):
        errors = validate_answers(DEF, _with_conn({"to": "epo-db-1"}))
        for field in ("direction", "protocol", "ports"):
            self.assertIn(f"servers[0].connections[0].{field}: is required", errors)

    def test_hidden_when_no_connections(self):
        a = json.loads(json.dumps(GOOD))
        for row in a["servers"]:
            row["has_connections"] = False
            row.pop("connections")
        self.assertEqual(validate_answers(DEF, a), [])
        self.assertEqual(normalize(a)["connections"], [])

    def test_answers_to_a_hidden_question_are_ignored(self):
        a = json.loads(json.dumps(GOOD))
        a["servers"][0]["has_connections"] = False
        # Only the database's own answer is left: the MSSQL connection, seen from its side.
        self.assertEqual(normalize(a)["connections"], [
            {"from": "epo-app-1", "to": "epo-db-1", "both": False, "protocol": "MSSQL", "ports": "1433"},
        ])

    def test_normalize_directions_and_duplicates(self):
        conns = normalize(GOOD)["connections"]
        self.assertEqual(conns, [
            {"from": "epo-app-1", "to": "epo-db-1", "both": False, "protocol": "MSSQL", "ports": "1433"},
            {"from": ENDPOINTS, "to": "epo-app-1", "both": False, "protocol": "HTTPS", "ports": "443, 8443"},
            {"from": "epo-app-1", "to": ENDPOINTS, "both": True, "protocol": "Agent", "ports": "8081"},
        ])

    def test_mermaid(self):
        out = build_mermaid([normalize(GOOD)])
        self.assertIn("srv_ePO_epo_app_1 -->|MSSQL 1433| srv_ePO_epo_db_1", out)
        self.assertIn('ep_ePO[["All endpoints"]]', out)
        self.assertIn("ep_ePO -->|HTTPS 443, 8443| srv_ePO_epo_app_1", out)
        self.assertIn("srv_ePO_epo_app_1 <-->|Agent 8081| ep_ePO", out)


class QuestionnaireV2Tests(unittest.TestCase):
    def test_removed_questions(self):
        ids = [q["id"] for q in DEF["questions"]]
        self.assertNotIn("server_count", ids)
        self.assertNotIn("depends_on", ids)

    def test_os_is_windows_or_linux(self):
        a = json.loads(json.dumps(GOOD))
        a["servers"][0]["os"] = "Solaris"
        self.assertEqual(validate_answers(DEF, a), ["servers[0].os: must be one of ['Windows', 'Linux']"])
        self.assertEqual(normalize(GOOD)["servers"][0]["os"], "Linux")


class SiteTests(unittest.TestCase):
    def _two_sites(self):
        a = json.loads(json.dumps(GOOD))
        a["has_other_sites"] = True
        a["other_servers"] = [{"site": "Sapir", "name": "epo-db-2", "role": "database", "os": "Linux",
                               "has_connections": False}]
        a["servers"][0]["connections"] = [{"to": "epo-db-2", "direction": OUT, "protocol": "MSSQL", "ports": "1433"}]
        a["servers"][1]["has_connections"] = False
        a["servers"][1].pop("connections")
        return a

    def test_primary_site_is_required_and_one_of_three(self):
        a = dict(GOOD)
        a.pop("primary_site")
        self.assertIn("primary_site: is required", validate_answers(DEF, a))
        self.assertEqual(
            validate_answers(DEF, dict(GOOD, primary_site="Haifa")),
            ["primary_site: must be one of ['Ofek', 'Sapir', 'Mazpen']"],
        )

    def test_a_server_is_not_offered_to_itself(self):
        own = GOOD["servers"][0]
        self.assertEqual(choice_options(CONN["item"][0], GOOD, {"servers": own}), ["epo-db-1", ENDPOINTS])
        errors = validate_answers(DEF, _with_conn({"to": "epo-app-1", "direction": OUT, "protocol": "x", "ports": "1"}))
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("servers[0].connections[0].to: must be one of"))

    def test_servers_in_other_sites(self):
        a = self._two_sites()
        self.assertEqual(validate_answers(DEF, a), [])  # a connection across sites is allowed
        n = normalize(a)
        self.assertEqual([(x["name"], x["site"]) for x in n["servers"]],
                         [("epo-app-1", "Ofek"), ("epo-db-1", "Ofek"), ("epo-db-2", "Sapir")])
        self.assertEqual(n["sites"], ["Ofek", "Sapir"])
        self.assertEqual(n["connections"][0]["to"], "epo-db-2")

    def test_other_site_is_required(self):
        a = self._two_sites()
        a["other_servers"][0].pop("site")
        self.assertIn("other_servers[0].site: is required", validate_answers(DEF, a))

    def test_other_sites_ignored_when_answered_no(self):
        a = self._two_sites()
        a["has_other_sites"] = False
        self.assertEqual([x["name"] for x in normalize(a)["servers"]], ["epo-app-1", "epo-db-1"])

    def test_dr_site(self):
        n = normalize(dict(GOOD, dr_site="Mazpen"))
        self.assertEqual(n["dr_site"], "Mazpen")
        self.assertEqual(n["sites"], ["Mazpen", "Ofek"])
        self.assertEqual(normalize(dict(GOOD, dr_site=NO_DR))["dr_site"], "")
        self.assertEqual(normalize(dict(GOOD, dr_site=NO_DR))["sites"], ["Ofek"])

    def test_v1_answers_still_work(self):
        n = normalize({"system_name": "Billing", "servers": [{"name": "x", "site": "Haifa", "role": "app"}],
                       "has_dr": True, "dr_site": "Beer Sheva"})
        self.assertEqual(n["servers"][0]["site"], "Haifa")
        self.assertEqual((n["sites"], n["dr_site"]), (["Beer Sheva", "Haifa"], "Beer Sheva"))


class OptionsFromSchemaTests(unittest.TestCase):
    def _def(self, options_from):
        return {
            "id": "t", "version": 1, "title": "T",
            "questions": [
                {"id": "servers", "type": "list", "label": "S", "item": [{"id": "name", "type": "text", "label": "N"}]},
                {"id": "links", "type": "list", "label": "L",
                 "item": [{"id": "a", "type": "choice", "label": "A", "options_from": options_from}]},
            ],
        }

    def test_ok_without_fixed_options(self):
        self.assertEqual(check_definition(self._def("servers.name")), [])

    def test_list_of_sources(self):
        self.assertEqual(check_definition(self._def(["servers.name", "servers.name"])), [])
        self.assertIn("not a top-level list question", " ".join(check_definition(self._def(["servers.name", "x.y"]))))

    def test_bad_references(self):
        self.assertIn("not a top-level list question", " ".join(check_definition(self._def("nothing.name"))))
        self.assertIn("not a text question", " ".join(check_definition(self._def("servers.site"))))
        self.assertIn("must look like", " ".join(check_definition(self._def("servers"))))


if __name__ == "__main__":
    unittest.main()
