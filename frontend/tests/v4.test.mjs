// Questionnaire v4: servers and segments with the same name in different sites, one list of connections for
// all sites (between segments, several on each side), and the duplicate / copy-from-site flags.
// Mirrors backend/tests/test_v4.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { layout } from "../js/diagram.js";
import { choiceOptions, validate } from "../js/form-logic.js";
import { normalize } from "../js/model.js";

const def = JSON.parse(
  readFileSync(new URL("../../backend/questionnaires/system-basic.v4.json", import.meta.url), "utf-8"),
);
const Q = Object.fromEntries(def.questions.map((q) => [q.id, q]));
const SITE_ITEM = Object.fromEntries(Q.other_sites.item.map((q) => [q.id, q]));
const CONN = Object.fromEntries(Q.connections.item.map((q) => [q.id, q]));
const OUT = CONN.direction.options[0];

// Both sites have a segment called "DB" and a server called "db-1".
const GOOD = {
  system_name: "ePO",
  primary_site: "Ofek",
  segments: [{ name: "DB", subnet: "10.1.1.0/24" }, { name: "Core", subnet: "10.1.2.0/24" }],
  servers: [
    { name: "core-1", role: "app", os: "Windows", segment: "Core" },
    { name: "db-1", role: "database", os: "Windows", segment: "DB" },
  ],
  other_sites: [{
    site: "Sapir",
    segments: [{ name: "DB", subnet: "10.2.1.0/24" }],
    // pulled from Ofek with "Copy from another site": same name, other site
    servers: [{ name: "db-1", role: "database", os: "Windows", segment: "DB" }],
  }],
  dr_site: "Sapir",
  connections: [
    { from: ["Core (Ofek)"], to: ["DB (Ofek)", "DB (Sapir)"], direction: OUT, protocol: "TCP", ports: "1433" },
    { from: ["DB (Sapir)"], to: ["DB (Ofek)"], direction: OUT, protocol: "repl", ports: "5022" },
  ],
};
const copy = () => structuredClone(GOOD);

test("connections are one list at the end; other sites are not a section", () => {
  assert.equal(def.questions.at(-1).id, "connections");
  assert.ok(!("connections" in SITE_ITEM));
  assert.ok(CONN.from.multiple && CONN.to.multiple);
  assert.equal(Q.other_sites.collapsible, false);
  assert.ok(Q.servers.duplicate && Q.servers.copy_from_site && SITE_ITEM.servers.copy_from_site);
});

test("the same names in two sites are fine", () => {
  assert.deepEqual(validate(def.questions, GOOD), []);
});

test("server names differ within a site, and from its segments", () => {
  let a = copy();
  a.servers.push({ ...a.servers[1], name: "DB-1 " }); // a duplicate that kept the name
  assert.deepEqual(validate(def.questions, a),
    [{ path: "servers[2].name", message: "Already used in this list (see servers[1].name)" }]);
  a = copy();
  a.servers[0].name = "core";
  assert.deepEqual(validate(def.questions, a),
    [{ path: "servers[0].name", message: "Already used here (see the answers to segments.name)" }]);
});

test("connection options are the segments of every site", () => {
  const frames = [{ questions: Q.connections.item, row: GOOD.connections[0] }];
  assert.deepEqual(choiceOptions(CONN.from, GOOD, frames), ["DB (Ofek)", "Core (Ofek)", "DB (Sapir)"]);
  assert.deepEqual(choiceOptions(CONN.to, GOOD, frames), ["DB (Ofek)", "DB (Sapir)", "All endpoints"]);
});

test("several picks are checked", () => {
  const msg = (a) => validate(def.questions, a).map((e) => `${e.path}: ${e.message}`);
  let a = copy();
  a.connections[0].to = ["DB (Ofek)", "DB (Ofek)"];
  assert.deepEqual(msg(a), ["connections[0].to: An option is picked twice"]);
  a = copy();
  a.connections[0].to = ["Core (Ofek)"]; // also in "From"
  assert.deepEqual(msg(a), ["connections[0].to: Choose only from the options"]);
  a = copy();
  a.connections[0].from = "Core (Ofek)";
  assert.deepEqual(msg(a), ["connections[0].from: Must be a list of options"]);
  a = copy();
  a.connections[0].from = [];
  assert.deepEqual(msg(a), ["connections[0].from: This answer is required"]);
});

test("the model has one connection per pair", () => {
  const m = normalize(GOOD);
  assert.deepEqual(m.servers.map((s) => s.key), ["core-1 (Ofek)", "db-1 (Ofek)", "db-1 (Sapir)"]);
  assert.deepEqual(m.connections.map((c) => [c.from, c.to, c.ports]), [
    ["Core (Ofek)", "DB (Ofek)", "1433"], ["Core (Ofek)", "DB (Sapir)", "1433"], ["DB (Sapir)", "DB (Ofek)", "5022"],
  ]);
});

test("the diagram draws each connection to the right DB segment", () => {
  const L = layout([normalize(GOOD)], { showSystems: false });
  const seg = (site) => L.segments.find((g) => g.name === "DB" && g.site === site);
  const near = (p, g) => p.x >= g.x - 1 && p.x <= g.x + g.w + 1 && p.y >= g.y - 1 && p.y <= g.y + g.h + 1;
  const c = L.connections.find((x) => x.from === "DB (Sapir)");
  assert.ok(near(c.points[0], seg("Sapir")), "starts at Sapir's DB");
  assert.ok(near(c.points.at(-1), seg("Ofek")), "ends at Ofek's DB");
  const inside = (s, g) => s.x >= g.x && s.y >= g.y && s.x + s.w <= g.x + g.w && s.y + s.h <= g.y + g.h;
  const db1 = (site) => L.servers.find((s) => s.name === "db-1" && s.site === site);
  assert.ok(inside(db1("Sapir"), seg("Sapir")));
  assert.ok(inside(db1("Ofek"), seg("Ofek")));
  assert.equal(L.connections.filter((x) => x.from === "Core (Ofek)").length, 2);
});
