// The browser's copy of normalize (for the live diagram) must give the same model as the server's
// backend/app/core/normalize.py. These cases mirror backend/tests/test_connections.py.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ENDPOINTS } from "../js/diagram.js";
import { NO_DR, NO_SITE, normalize } from "../js/model.js";

const OUT = "Outgoing (this server opens it)";
const IN = "Incoming (the other side opens it)";
const BOTH = "Both directions";

const GOOD = {
  system_name: " ePO ",
  servers: [
    { name: "epo-app-1", site: "Haifa", role: "app", os: "Linux", has_connections: true, connections: [
      { to: "epo-db-1", direction: OUT, protocol: "MSSQL", ports: "1433" },
      { to: ENDPOINTS, direction: IN, protocol: "HTTPS", ports: "443, 8443" },
      { to: ENDPOINTS, direction: BOTH, protocol: "Agent", ports: "8081" },
    ] },
    // The same MSSQL connection described from the database's side: counts once.
    { name: "epo-db-1", site: "Haifa", role: "database", os: "Windows", has_connections: true, connections: [
      { to: "epo-app-1", direction: IN, protocol: "MSSQL", ports: "1433" },
    ] },
  ],
  has_dr: true,
  dr_site: "Beer Sheva",
};

test("v2: primary site, other sites, DR site (as in backend/tests/test_connections.py)", () => {
  const m = normalize({
    primary_site: "Ofek",
    system_name: "ePO",
    servers: [{ name: "epo-app-1", role: "app", os: "Linux", has_connections: true,
      connections: [{ to: "epo-db-2", direction: OUT, protocol: "MSSQL", ports: "1433" }] }],
    has_other_sites: true,
    other_servers: [{ site: "Sapir", name: "epo-db-2", role: "database", os: "Linux", has_connections: false }],
    dr_site: "Mazpen",
  });
  assert.deepEqual(m.servers.map((s) => [s.name, s.site]), [["epo-app-1", "Ofek"], ["epo-db-2", "Sapir"]]);
  assert.deepEqual(m.sites, ["Mazpen", "Ofek", "Sapir"]);
  assert.equal(m.dr_site, "Mazpen");
  assert.equal(m.connections[0].to, "epo-db-2 (Sapir)");
  assert.equal(normalize({ primary_site: "Ofek", dr_site: NO_DR }).dr_site, "");
  const no = normalize({ primary_site: "Ofek", has_other_sites: false, other_servers: [{ site: "Sapir", name: "x" }] });
  assert.deepEqual(no.servers, []);
});

test("v1 answers: same model as the server: directions, duplicates, DR site", () => {
  const m = normalize(GOOD);
  assert.equal(m.system, "ePO");
  assert.deepEqual(m.sites, ["Beer Sheva", "Haifa"]);
  assert.deepEqual(m.servers[0], { name: "epo-app-1", site: "Haifa", role: "app", os: "Linux", segment: "", key: "epo-app-1 (Haifa)" });
  assert.deepEqual(m.connections, [
    { from: "epo-app-1 (Haifa)", to: "epo-db-1 (Haifa)", both: false, protocol: "MSSQL", ports: "1433" },
    { from: ENDPOINTS, to: "epo-app-1 (Haifa)", both: false, protocol: "HTTPS", ports: "443, 8443" },
    { from: "epo-app-1 (Haifa)", to: ENDPOINTS, both: true, protocol: "Agent", ports: "8081" },
  ]);
});

test("connections of a server that answered No are ignored", () => {
  const a = structuredClone(GOOD);
  a.servers[0].has_connections = false;
  assert.deepEqual(normalize(a).connections, [
    { from: "epo-app-1 (Haifa)", to: "epo-db-1 (Haifa)", both: false, protocol: "MSSQL", ports: "1433" },
  ]);
});

test("half-filled answers still give a model to draw", () => {
  assert.deepEqual(normalize({}), { system: "", servers: [], segments: [], sites: [], dr_site: "", links: [], connections: [], skipping: [] });
  const m = normalize({
    servers: [
      { name: "", site: "Haifa" }, // no name yet: not drawn
      { name: "web-1" }, // no site yet
      { name: "web-2", site: "Haifa", has_connections: true, connections: [{ direction: OUT }] }, // no target yet
    ],
  });
  assert.deepEqual(m.servers.map((s) => [s.name, s.site]), [["web-1", NO_SITE], ["web-2", "Haifa"]]);
  assert.deepEqual(m.connections, []);
});
