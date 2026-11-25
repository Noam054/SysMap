import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ENDPOINTS, distToPolyline, layout, renderSvg } from "../js/diagram.js";
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

test("one system per picture: no system name inside; endpoints are tags, not a box", () => {
  const L = layout([MODEL], ONE);
  assert.equal(L.systems.length, 0);
  assert.equal(L.edges.length, 0);
  assert.equal(L.links.length, 0);
  assert.equal(L.connections.length, 1, "only server-to-server connections are lines");
  assert.deepEqual(L.sites.map((s) => s.name), ["Ofek"], "no Endpoints site");
  const app = L.servers.find((s) => s.name === "epo-app-1");
  assert.deepEqual(app.tags.map((t) => [t.arrow, t.label]), [["↔", "HTTPS 443, 8443"]]);
  const svg = renderSvg([MODEL], ONE);
  for (const word of ["MSSQL 1433", "↔ ENDPOINTS", "HTTPS 443, 8443"]) assert.ok(svg.includes(word), word);
  assert.ok(svg.includes('fill="#ffffff"/>'), "white background by default (downloads)");
  assert.ok(!renderSvg([MODEL], { ...ONE, background: false }).includes('<rect width='), "see-through for the dotted canvas");
  assert.ok(!svg.includes("ePO"), "system name not drawn anywhere (server names are lowercase epo-…)");
  assert.ok(!svg.includes(">Auth<"), "other systems not drawn");
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

test("the DR site is marked", () => {
  const svg = renderSvg([{ ...MODEL, sites: ["Mazpen", "Ofek"], dr_site: "Mazpen" }], ONE);
  assert.ok(svg.includes(">Mazpen<") && svg.includes(">DR<"));
  assert.ok(!renderSvg([MODEL], ONE).includes(">DR<"));
});

// Three sites; connections between neighbours, across a site, inside one site and both ways.
const S = (name, site, role) => ({ name, site, role, os: "Linux" });
const BUSY = {
  system: "Busy", sites: ["Mazpen", "Ofek", "Sapir"], dr_site: "Mazpen", links: [],
  servers: [S("web-1", "Ofek", "web"), S("app-1", "Ofek", "app"), S("app-2", "Ofek", "app"),
    S("db-1", "Sapir", "database"), S("db-2", "Sapir", "database"), S("dr-app", "Mazpen", "app")],
  connections: [
    { from: "web-1", to: "app-1", both: false, protocol: "https", ports: "8443" },
    { from: "app-1", to: "db-1", both: false, protocol: "mssql", ports: "1433" },
    { from: "app-2", to: "db-2", both: true, protocol: "tcp", ports: "5000" },
    { from: "dr-app", to: "db-1", both: false, protocol: "mssql", ports: "1433" },
    { from: "db-1", to: "db-2", both: true, protocol: "repl", ports: "5022" },
    { from: "dr-app", to: "app-1", both: false, protocol: "tcp", ports: "8080" },
    { from: "web-1", to: ENDPOINTS, both: false, protocol: "https", ports: "443" },
  ],
};

const inside = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Checks every picture must pass: lines avoid other servers and each other, labels cover nothing.
function checkPicture(L) {
  L.connections.forEach((c, i) => {
    assert.doesNotMatch(c.d, / [HV] /, "lines are not drawn as right angles");
    for (const s of L.servers) {
      if (s.name === c.from || s.name === c.to) continue;
      const box = { x: s.x + 8, y: s.y + 2, w: s.w - 16, h: s.h - 4 };
      assert.ok(!c.points.some((p) => inside(box, p)), `${c.from} → ${c.to} goes through ${s.name}`);
    }
    L.connections.forEach((d, j) => {
      if (j <= i) return;
      const ends = [c.points[0], c.points[c.points.length - 1], d.points[0], d.points[d.points.length - 1]];
      // Crossing is fine; running along each other is not (several points in a row right next to the other line).
      let run = 0;
      let longest = 0;
      for (const p of c.points) {
        run = ends.every((e) => Math.hypot(p.x - e.x, p.y - e.y) > 30) && distToPolyline(p, d.points) < 5 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      assert.ok(longest <= 3, `${c.from} → ${c.to} runs along ${d.from} → ${d.to}`);
    });
    if (!c.labelBox) return;
    for (const s of L.servers) assert.ok(!boxesOverlap(c.labelBox, { x: s.x + 6, y: s.y, w: s.w - 12, h: s.h }), `label ${c.label} on ${s.name}`);
    L.connections.forEach((d, j) => {
      if (j !== i && d.labelBox) assert.ok(!boxesOverlap(c.labelBox, d.labelBox), `label ${c.label} on label ${d.label}`);
    });
  });
}

test("lines avoid other servers and each other; labels cover no server or label", () => {
  const L = layout([BUSY], ONE);
  assert.equal(L.connections.length, 6);
  checkPicture(L);
  const svg = renderSvg([BUSY], ONE);
  assert.equal((svg.match(/marker-start=/g) || []).length, 2, "the two two-way connections have two arrow heads");
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

test("a crowded site: every server talks to every other", () => {
  const names = ["a1", "a2", "a3", "a4", "a5"];
  const model = {
    system: "Mesh", sites: ["Ofek"], dr_site: "", links: [],
    servers: names.map((n) => S(n, "Ofek", "app")),
    connections: names.flatMap((n, i) => names.slice(i + 1).map((m) => ({ from: n, to: m, both: false, protocol: "tcp", ports: "1" }))),
  };
  const L = layout([model], ONE);
  assert.equal(L.connections.length, 10);
  checkPicture(L);
});

test("everything stays inside the picture", () => {
  for (const model of [MODEL, BUSY]) {
    const L = layout([model], ONE);
    const inPicture = (b) => b.x >= 0 && b.y >= 0 && b.x + (b.w || 0) <= L.width && b.y + (b.h || 0) <= L.height;
    for (const s of [...L.sites, ...L.servers]) assert.ok(inPicture(s), s.name);
    for (const c of L.connections) {
      assert.ok(c.points.every(inPicture), "line inside");
      if (c.labelBox) assert.ok(inPicture(c.labelBox), "label inside");
    }
  }
});

test("server names must be different, in all sites (upper/lower case does not count)", () => {
  const a = structuredClone(ANSWERS);
  a.has_other_sites = true;
  a.other_servers = [{ site: "Sapir", name: " EPO-APP-1 ", role: "app", os: "Linux", has_connections: false }];
  const errors = validate(Q, a);
  assert.deepEqual(errors.map((e) => e.path), ["other_servers[0].name"]);
  assert.match(errors[0].message, /servers\[0\]\.name/);
});

test("a connection to an unknown server is skipped, not drawn wrong", () => {
  const L = layout([{ ...MODEL, connections: [{ from: "ghost", to: "epo-db-1", protocol: "x", ports: "1" }] }]);
  assert.equal(L.connections.length, 0);
});
