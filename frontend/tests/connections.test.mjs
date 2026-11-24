import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ENDPOINTS, layout, renderSvg } from "../js/diagram.js";
import { choiceOptions, validate } from "../js/form-logic.js";

const def = JSON.parse(
  readFileSync(new URL("../../backend/questionnaires/system-basic.v2.json", import.meta.url), "utf-8"),
);
const Q = def.questions;
const CONN = Q.find((q) => q.id === "servers").item.find((q) => q.id === "connections");
const TO = CONN.item[0];
const [OUT, , BOTH] = CONN.item[1].options;

const ANSWERS = {
  primary_site: "Ofek",
  system_name: "ePO",
  servers: [
    { name: "epo-app-1", role: "app", os: "Linux", has_connections: true, connections: [
      { to: "epo-db-1", direction: OUT, protocol: "MSSQL", ports: "1433" },
      { to: ENDPOINTS, direction: BOTH, protocol: "HTTPS", ports: "443, 8443" },
    ] },
    { name: "epo-db-1", role: "database", os: "Windows", has_connections: false },
  ],
};

// What the server makes of these answers (see backend/app/core/normalize.py).
const MODEL = {
  system: "ePO",
  sites: ["Ofek"],
  dr_site: "",
  servers: ANSWERS.servers.map(({ name, role, os }) => ({ name, site: "Ofek", role, os })),
  links: [{ to: "Auth", protocol: "LDAPS" }],
  connections: [
    { from: "epo-app-1", to: "epo-db-1", both: false, protocol: "MSSQL", ports: "1433" },
    { from: "epo-app-1", to: ENDPOINTS, both: true, protocol: "HTTPS", ports: "443, 8443" },
  ],
};
const ONE = { showSystems: false };

test("'Connected to' options are the typed server names plus All endpoints", () => {
  assert.deepEqual(choiceOptions(TO, ANSWERS), ["epo-app-1", "epo-db-1", ENDPOINTS]);
  assert.deepEqual(choiceOptions(TO, {}), [ENDPOINTS]);
});

test("a server is not offered to itself", () => {
  assert.deepEqual(choiceOptions(TO, ANSWERS, { servers: ANSWERS.servers[0] }), ["epo-db-1", ENDPOINTS]);
  const self = structuredClone(ANSWERS);
  self.servers[0].connections = [{ to: "epo-app-1", direction: OUT, protocol: "x", ports: "1" }];
  assert.deepEqual(validate(Q, self).map((e) => e.path), ["servers[0].connections[0].to"]);
});

test("servers in other sites can be connected to", () => {
  const a = structuredClone(ANSWERS);
  a.has_other_sites = true;
  a.other_servers = [{ site: "Sapir", name: "epo-db-2", role: "database", os: "Linux", has_connections: false }];
  a.servers[0].connections = [{ to: "epo-db-2", direction: OUT, protocol: "MSSQL", ports: "1433" }];
  assert.deepEqual(choiceOptions(TO, a, { servers: a.servers[0] }), ["epo-db-1", "epo-db-2", ENDPOINTS]);
  assert.deepEqual(validate(Q, a), []);
});

test("connections validate like the server does", () => {
  assert.deepEqual(validate(Q, ANSWERS), []);
  const bad = structuredClone(ANSWERS);
  bad.servers[0].connections = [{ to: "nope" }];
  const paths = validate(Q, bad).map((e) => e.path).sort();
  assert.deepEqual(paths, [
    "servers[0].connections[0].direction",
    "servers[0].connections[0].ports",
    "servers[0].connections[0].protocol",
    "servers[0].connections[0].to",
  ]);
});

test("one system per picture: no system name inside, connections and Endpoints box drawn", () => {
  const L = layout([MODEL], ONE);
  assert.equal(L.systems.length, 0);
  assert.equal(L.edges.length, 0);
  assert.equal(L.links.length, 0);
  assert.equal(L.connections.length, 2);
  assert.ok(L.sites.find((s) => s.endpoints), "endpoints column");
  const svg = renderSvg([MODEL], ONE);
  for (const word of ["MSSQL 1433", "HTTPS 443, 8443", "All endpoints", "Endpoints"]) assert.ok(svg.includes(word), word);
  assert.ok(svg.includes('fill="#ffffff"/>'), "white background by default (downloads)");
  assert.ok(!renderSvg([MODEL], { ...ONE, background: false }).includes('<rect width='), "see-through for the dotted canvas");
  assert.ok(!svg.includes("ePO"), "system name not drawn anywhere (server names are lowercase epo-…)");
  assert.ok(!svg.includes(">Auth<"), "other systems not drawn");
  assert.equal((svg.match(/marker-start=/g) || []).length, 1, "only the two-way connection has two arrow heads");
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

test("the DR site is marked", () => {
  const svg = renderSvg([{ ...MODEL, sites: ["Mazpen", "Ofek"], dr_site: "Mazpen" }], ONE);
  assert.ok(svg.includes("Site: Mazpen") && svg.includes(">DR<"));
  assert.ok(!renderSvg([MODEL], ONE).includes(">DR<"));
});

test("everything stays inside the picture", () => {
  const L = layout([MODEL], ONE);
  for (const s of L.sites) assert.ok(s.x >= 0 && s.x + s.w <= L.width && s.y >= 0, s.name);
  for (const c of L.connections) {
    const xs = c.d.match(/-?\d+(\.\d+)?/g).filter((_, i) => i % 2 === 0).map(Number);
    assert.ok(Math.max(...xs) <= L.width, "curve within width");
  }
});

test("a connection to an unknown server is skipped, not drawn wrong", () => {
  const L = layout([{ ...MODEL, connections: [{ from: "ghost", to: "epo-db-1", protocol: "x", ports: "1" }] }]);
  assert.equal(L.connections.length, 0);
});
