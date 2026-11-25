"""Questionnaire v3: network segments, IP addresses, site blocks ("Add site") and site-level connections."""
import json
import unittest
from pathlib import Path

from app.core.diagram import build_mermaid
from app.core.normalize import ENDPOINTS, normalize
from app.core.schema_check import check_definition
from app.core.validation import choice_options, cidr, validate_answers

DEF = json.loads((Path(__file__).parent.parent / "questionnaires" / "system-basic.v3.json").read_text())
Q = {q["id"]: q for q in DEF["questions"]}
SITE_ITEM = {q["id"]: q for q in Q["other_sites"]["item"]}
CONN = {q["id"]: q for q in Q["connections"]["item"]}
OUT, IN, BOTH = CONN["direction"]["options"]

GOOD = {
    "system_name": "ePO",
    "primary_site": "Ofek",
    "segments": [
        {"name": "Servers", "subnet": "10.1.2.0/24"},
        {"name": "Users", "subnet": " 10.9.0.0 / 16 "},
    ],
    "servers": [
        {"name": "epo-app-1", "role": "app", "os": "Linux", "segment": "Servers"},
        {"name": "epo-db-1", "role": "database", "os": "Windows", "segment": "Servers"},
    ],
    "connections": [
        {"from": "epo-app-1", "to": "epo-db-1", "direction": OUT, "protocol": "MSSQL", "ports": "1433"},
        {"from": "Users", "to": "epo-app-1", "direction": OUT, "protocol": "HTTPS", "ports": "443"},
        {"from": "epo-app-1", "to": ENDPOINTS, "direction": BOTH, "protocol": "Agent", "ports": "8081"},
    ],
    "other_sites": [{
        "site": "Sapir",
        "segments": [{"name": "DR-Servers", "subnet": "10.2.2.0/24"}],
        "servers": [{"name": "epo-db-2", "role": "database", "os": "Windows", "segment": "DR-Servers"}],
        "connections": [{"from": "epo-db-2", "to": "epo-db-1", "direction": IN, "protocol": "MSSQL", "ports": "5022"}],
    }],
    "dr_site": "Sapir",
}


def copy(**changes):
    a = json.loads(json.dumps(GOOD))
    a.update(changes)
    return a


class V3Tests(unittest.TestCase):
    def test_file_is_valid_and_asks_the_name_first(self):
        self.assertEqual(check_definition(DEF), [])
        self.assertEqual([q["id"] for q in DEF["questions"]][:2], ["system_name", "primary_site"])

    def test_good_answers(self):
        self.assertEqual(validate_answers(DEF, GOOD), [])

    def test_subnet_format(self):
        a = copy()
        a["segments"][0]["subnet"] = "10.1.2.5/24"  # not the network address
        a["segments"][1]["subnet"] = "10.9.0.0"
        errors = validate_answers(DEF, a)
        self.assertEqual([e.split(":")[0] for e in errors], ["segments[0].subnet", "segments[1].subnet"])
        self.assertIn("must be a subnet like 14.151.0.0/24", errors[0])
        self.assertEqual([cidr(x) for x in ("14.151.0.0/24", "0.0.0.0/0", "10.0.0.0/33", "10.0.0.1/32", "10.0.0.0 /8", "a/8")],
                         [(244776960, 24), (0, 0), None, (167772161, 32), (167772160, 8), None])

    def test_names_are_unique(self):
        a = copy()
        a["other_sites"][0]["segments"][0]["name"] = "epo-app-1"  # a segment named like a server
        self.assertIn("other_sites[0].segments[0].name: is already used (see servers[0].name)", " ".join(validate_answers(DEF, a)))

    def test_no_segments_leaves_the_segment_empty(self):
        a = copy()
        a["other_sites"][0]["segments"] = []
        del a["other_sites"][0]["servers"][0]["segment"]
        self.assertEqual(validate_answers(DEF, a), [])

    def test_segment_choice_lists_only_this_sites_segments(self):
        seg_q = next(q for q in SITE_ITEM["servers"]["item"] if q["id"] == "segment")
        block = GOOD["other_sites"][0]
        frames = [(Q["other_sites"]["item"], block), (SITE_ITEM["servers"]["item"], block["servers"][0])]
        self.assertEqual(choice_options(seg_q, GOOD, frames), ["DR-Servers"])
        a = copy()
        a["other_sites"][0]["servers"][0]["segment"] = "Servers"  # a segment of the primary site
        self.assertTrue(validate_answers(DEF, a)[0].startswith("other_sites[0].servers[0].segment: must be one of"))

    def test_connection_options(self):
        frames = [(Q["connections"]["item"], GOOD["connections"][0])]
        self.assertEqual(choice_options(CONN["from"], GOOD, frames), ["epo-app-1", "epo-db-1", "Servers", "Users"])
        # "To" offers every site, never the "From" answer, and All endpoints
        self.assertEqual(choice_options(CONN["to"], GOOD, frames),
                         ["epo-db-1", "Servers", "Users", "epo-db-2", "DR-Servers", ENDPOINTS])
        a = copy()
        a["connections"][0]["to"] = "epo-app-1"
        self.assertTrue(validate_answers(DEF, a)[0].startswith("connections[0].to: must be one of"))
        a = copy()
        a["connections"][0]["from"] = "epo-db-2"  # "From" must be in this site
        self.assertTrue(validate_answers(DEF, a)[0].startswith("connections[0].from: must be one of"))

    def test_each_site_once(self):
        site_q = SITE_ITEM["site"]
        frames = [(Q["other_sites"]["item"], GOOD["other_sites"][0])]
        self.assertEqual(choice_options(site_q, GOOD, frames), ["Sapir", "Mazpen"])  # not the primary site
        a = copy(other_sites=GOOD["other_sites"] * 2)
        a["other_sites"] = json.loads(json.dumps(a["other_sites"]))
        a["other_sites"][1]["site"] = "Ofek"
        self.assertTrue(any(e.startswith("other_sites[1].site: must be one of ['Mazpen']") for e in validate_answers(DEF, a)))
        self.assertEqual(choice_options(Q["dr_site"], GOOD), ["No DR site", "Sapir", "Mazpen"])

    def test_model(self):
        m = normalize(GOOD)
        self.assertEqual(m["sites"], ["Ofek", "Sapir"])
        self.assertEqual(m["dr_site"], "Sapir")
        self.assertEqual(m["segments"][0], {"name": "Servers", "site": "Ofek", "subnet": "10.1.2.0/24", "key": "Servers (Ofek)"})
        self.assertEqual(m["segments"][1]["subnet"], "10.9.0.0/16")
        self.assertEqual(m["servers"][2], {"name": "epo-db-2", "site": "Sapir", "role": "database", "os": "Windows",
                                           "segment": "DR-Servers", "key": "epo-db-2 (Sapir)"})
        self.assertEqual(m["connections"], [
            {"from": "epo-app-1 (Ofek)", "to": "epo-db-1 (Ofek)", "both": False, "protocol": "MSSQL", "ports": "1433"},
            {"from": "Users (Ofek)", "to": "epo-app-1 (Ofek)", "both": False, "protocol": "HTTPS", "ports": "443"},  # v3 named them without their site
            {"from": "epo-app-1 (Ofek)", "to": ENDPOINTS, "both": True, "protocol": "Agent", "ports": "8081"},
            {"from": "epo-db-1 (Ofek)", "to": "epo-db-2 (Sapir)", "both": False, "protocol": "MSSQL", "ports": "5022"},
        ])

    def test_mermaid_has_segments(self):
        text = build_mermaid([normalize(GOOD)])
        self.assertIn('subgraph seg_ePO_Servers__Ofek_["Servers 10.1.2.0/24"]', text)
        self.assertIn("seg_ePO_Users__Ofek_ -->|HTTPS 443| srv_ePO_epo_app_1__Ofek_", text)
        self.assertIn('srv_ePO_epo_app_1__Ofek_["epo-app-1 (app)"]', text)


class NewFieldSchemaTests(unittest.TestCase):
    def _def(self, **extra):
        return {"id": "t", "version": 1, "title": "T", "questions": [
            {"id": "segs", "type": "list", "label": "S", "item": [
                {"id": "name", "type": "text", "label": "N"},
                {"id": "subnet", "type": "text", "label": "Subnet", "format": "cidr"}]},
            {"id": "hosts", "type": "list", "label": "H", "item": [
                {"id": "seg", "type": "choice", "label": "Seg", "options_from": "segs.name"},
                {"id": "x", "type": "text", "label": "X", **extra}]},
        ]}

    def test_good(self):
        self.assertEqual(check_definition(self._def(format="ipv4")), [])

    def test_bad(self):
        def problems(**extra):
            return " ".join(check_definition(self._def(**extra)))
        self.assertIn("format must be one of", problems(format="ipv6"))
        self.assertIn("exclude only works on choice", problems(exclude="/segs.name"))
        self.assertIn("differs_from must name an earlier question", problems(differs_from="nope"))
        self.assertIn("start_empty only works on list", problems(start_empty=True))


if __name__ == "__main__":
    unittest.main()
