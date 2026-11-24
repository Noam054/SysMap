import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeXml, layout, renderSvg } from "../js/diagram.js";

const MODELS = [
  {
    system: "Billing",
    sites: ["Beer Sheva", "Haifa"],
    servers: [
      { name: "bill-app-1", site: "Haifa", role: "app", os: "RHEL 9" },
      { name: "bill-db-1", site: "Haifa", role: "database", os: "" },
    ],
    links: [{ to: "Auth", protocol: "LDAPS/636" }],
  },
  {
    system: "Auth",
    sites: ["Tel Aviv"],
    servers: [{ name: "auth-1", site: "Tel Aviv", role: "app" }],
    links: [],
  },
];

test("empty data gives no diagram", () => {
  assert.equal(renderSvg([]), null);
  assert.equal(renderSvg(null), null);
});

test("layout places every system, site, server and link", () => {
  const L = layout(MODELS);
  assert.equal(L.systems.length, 2);
  assert.equal(L.sites.length, 3); // Beer Sheva (empty DR site), Haifa, Tel Aviv
  assert.equal(L.servers.length, 3);
  assert.equal(L.links.length, 1);
  assert.equal(L.edges.length, 2); // Billing -> Haifa, Auth -> Tel Aviv (one line per system and site)
  assert.ok(L.sites.find((s) => s.name === "Beer Sheva").empty);
});

test("a link to an unknown system creates a 'not described yet' node", () => {
  const L = layout([{ system: "Billing", sites: [], servers: [], links: [{ to: "Mystery", protocol: "" }] }]);
  const mystery = L.systems.find((s) => s.name === "Mystery");
  assert.ok(mystery);
  assert.equal(mystery.described, false);
});

test("nothing overlaps: servers stay inside their site box", () => {
  const L = layout(MODELS);
  for (const srv of L.servers) {
    const site = L.sites.find((s) => s.name === srv.site);
    assert.ok(srv.x >= site.x && srv.x + srv.w <= site.x + site.w, "inside horizontally");
    assert.ok(srv.y >= site.y && srv.y + srv.h <= site.y + site.h, "inside vertically");
  }
  for (const s of [...L.systems, ...L.sites]) {
    assert.ok(s.x >= 0 && s.x + s.w <= L.width, `${s.name} within width`);
  }
  assert.ok(L.sites.every((s) => s.y + s.h <= L.height));
});

test("svg contains the names and no broken numbers", () => {
  const svg = renderSvg(MODELS);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  for (const word of ["Billing", "Auth", "bill-app-1", "Site: Haifa", "LDAPS/636", "no servers described"]) {
    assert.ok(svg.includes(word), word);
  }
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
});

test("special characters in names are escaped", () => {
  const svg = renderSvg([
    { system: `<img src=x onerror="alert(1)">`, sites: [], servers: [{ name: "a&b", site: "<s>", role: "app" }], links: [] },
  ]);
  assert.ok(!svg.includes("<img"));
  assert.ok(!svg.includes("<s>"));
  assert.ok(svg.includes("a&amp;b"));
  assert.equal(escapeXml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("a single system with no servers still renders", () => {
  const svg = renderSvg([{ system: "Alone", sites: [], servers: [], links: [] }]);
  assert.ok(svg.includes("Alone"));
});
