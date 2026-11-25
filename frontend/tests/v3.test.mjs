// Questionnaire v3: segments, IP addresses, site blocks and site-level connections.
// Mirrors backend/tests/test_v3.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ENDPOINTS, layout, renderSvg } from "../js/diagram.js";
import { choiceOptions, cidr, validate } from "../js/form-logic.js";
import { normalize } from "../js/model.js";

const def = JSON.parse(
  readFileSync(new URL("../../backend/questionnaires/system-basic.v3.json", import.meta.url), "utf-8"),
);
const Q = Object.fromEntries(def.questions.map((q) => [q.id, q]));
const SITE_ITEM = Object.fromEntries(Q.other_sites.item.map((q) => [q.id, q]));
const CONN = Object.fromEntries(Q.connections.item.map((q) => [q.id, q]));
const [OUT, IN, BOTH] = CONN.direction.options;

const GOOD = {
  system_name: "ePO",
  primary_site: "Ofek",
  segments: [
    { name: "Servers", subnet: "10.1.2.0/24" },
    { name: "Users", subnet: " 10.9.0.0 / 16 " },
  ],
  servers: [
    { name: "epo-app-1", role: "app", os: "Linux", segment: "Servers" },
    { name: "epo-db-1", role: "database", os: "Windows", segment: "Servers" },
  ],
  connections: [
    { from: "epo-app-1", to: "epo-db-1", direction: OUT, protocol: "MSSQL", ports: "1433" },
    { from: "Users", to: "epo-app-1", direction: OUT, protocol: "HTTPS", ports: "443" },
    { from: "epo-app-1", to: ENDPOINTS, direction: BOTH, protocol: "Agent", ports: "8081" },
  ],
  other_sites: [{
    site: "Sapir",
    segments: [{ name: "DR-Servers", subnet: "10.2.2.0/24" }],
    servers: [{ name: "epo-db-2", role: "database", os: "Windows", segment: "DR-Servers" }],
    connections: [{ from: "epo-db-2", to: "epo-db-1", direction: IN, protocol: "MSSQL", ports: "5022" }],
  }],
  dr_site: "Sapir",
};
const copy = () => structuredClone(GOOD);
const paths = (answers) => validate(def.questions, answers).map((e) => e.path);

test("the name is asked first, and good answers pass", () => {
  assert.deepEqual(def.questions.slice(0, 2).map((q) => q.id), ["system_name", "primary_site"]);
  assert.deepEqual(validate(def.questions, GOOD), []);
});

test("a segment's subnet is written like 14.151.0.0/24", () => {
  const a = copy();
  a.segments[0].subnet = "10.1.2.5/24"; // not the network address
  a.segments[1].subnet = "10.9.0.0";
  assert.deepEqual(paths(a), ["segments[0].subnet", "segments[1].subnet"]);
  assert.ok(validate(def.questions, a)[0].message.startsWith("Must be a subnet like 14.151.0.0/24"));
  assert.deepEqual(["14.151.0.0/24", "0.0.0.0/0", "10.0.0.0/33", "10.0.0.1/32", "10.0.0.0 /8", "a/8"].map(cidr),
    [[244776960, 24], [0, 0], null, [167772161, 32], [167772160, 8], null]);
});

test("segment and server names are unique across sites", () => {
  const a = copy();
  a.other_sites[0].segments[0].name = "epo-app-1";
  assert.ok(paths(a).includes("other_sites[0].segments[0].name"));
});

test("with no segments, a server's segment is left empty", () => {
  const a = copy();
  a.other_sites[0].segments = [];
  delete a.other_sites[0].servers[0].segment;
  assert.deepEqual(validate(def.questions, a), []);
});

test("a server's segment is one of its own site's segments", () => {
  const segQ = SITE_ITEM.servers.item.find((q) => q.id === "segment");
  const block = GOOD.other_sites[0];
  const frames = [{ questions: Q.other_sites.item, row: block }, { questions: SITE_ITEM.servers.item, row: block.servers[0] }];
  assert.deepEqual(choiceOptions(segQ, GOOD, frames), ["DR-Servers"]);
  const a = copy();
  a.other_sites[0].servers[0].segment = "Servers";
  assert.deepEqual(paths(a), ["other_sites[0].servers[0].segment"]);
});

test("connection options: From is this site, To is any site minus From", () => {
  const frames = [{ questions: Q.connections.item, row: GOOD.connections[0] }];
  assert.deepEqual(choiceOptions(CONN.from, GOOD, frames), ["epo-app-1", "epo-db-1", "Servers", "Users"]);
  assert.deepEqual(choiceOptions(CONN.to, GOOD, frames), ["epo-db-1", "Servers", "Users", "epo-db-2", "DR-Servers", ENDPOINTS]);
  const a = copy();
  a.connections[0].to = "epo-app-1";
  assert.deepEqual(paths(a), ["connections[0].to"]);
});

test("each site is offered once", () => {
  const frames = [{ questions: Q.other_sites.item, row: GOOD.other_sites[0] }];
  assert.deepEqual(choiceOptions(SITE_ITEM.site, GOOD, frames), ["Sapir", "Mazpen"]);
  assert.deepEqual(choiceOptions(Q.dr_site, GOOD), ["No DR site", "Sapir", "Mazpen"]);
  const a = copy();
  a.other_sites.push({ ...structuredClone(a.other_sites[0]), site: "Ofek" });
  assert.ok(paths(a).includes("other_sites[1].site"));
});

test("model, same as the server's", () => {
  const m = normalize(GOOD);
  assert.deepEqual(m.sites, ["Ofek", "Sapir"]);
  assert.deepEqual(m.segments[0], { name: "Servers", site: "Ofek", subnet: "10.1.2.0/24", key: "Servers (Ofek)" });
  assert.equal(m.segments[1].subnet, "10.9.0.0/16");
  assert.deepEqual(m.servers[2], { name: "epo-db-2", site: "Sapir", role: "database", os: "Windows", segment: "DR-Servers", key: "epo-db-2 (Sapir)" });
  assert.deepEqual(m.connections, [
    { from: "epo-app-1 (Ofek)", to: "epo-db-1 (Ofek)", both: false, protocol: "MSSQL", ports: "1433" },
    { from: "Users (Ofek)", to: "epo-app-1 (Ofek)", both: false, protocol: "HTTPS", ports: "443" },
    { from: "epo-app-1 (Ofek)", to: ENDPOINTS, both: true, protocol: "Agent", ports: "8081" },
    { from: "epo-db-1 (Ofek)", to: "epo-db-2 (Sapir)", both: false, protocol: "MSSQL", ports: "5022" },
  ]);
});

test("diagram: servers sit inside their segment, segments inside their site", () => {
  const L = layout([normalize(GOOD)], { showSystems: false });
  const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  for (const s of L.servers) {
    const g = L.segments.find((x) => x.name === s.segment);
    assert.ok(inside(s, g), `${s.name} inside ${g.name}`);
  }
  for (const g of L.segments) assert.ok(inside(g, L.sites.find((x) => x.name === g.site)), `${g.name} inside its site`);
  // segments of one site do not overlap
  const [a, b] = L.segments.filter((g) => g.site === "Ofek");
  assert.ok(a.y + a.h <= b.y);
  assert.equal(L.segments.find((g) => g.name === "Users").count, 0);
});

test("diagram: a segment's connection ends on the segment's border", () => {
  const L = layout([normalize(GOOD)], { showSystems: false });
  const users = L.segments.find((g) => g.name === "Users");
  const c = L.connections.find((x) => x.from === "Users (Ofek)");
  const p = c.points[0];
  const onEdge = Math.min(Math.abs(p.x - users.x), Math.abs(p.x - users.x - users.w), Math.abs(p.y - users.y), Math.abs(p.y - users.y - users.h));
  assert.ok(onEdge < 0.5, "starts on the border");
  const svg = renderSvg([normalize(GOOD)], { showSystems: false });
  assert.ok(svg.includes(">10.1.2.0/24<"));
  assert.ok(svg.includes("no servers in this segment"));
});
