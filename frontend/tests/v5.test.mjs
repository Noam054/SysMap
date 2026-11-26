// Questionnaire v5: servers that are turned off right now (standby), and the skipping process: steps that turn
// servers off or on. Mirrors backend/tests/test_v5.py, plus what the diagram greys out at each step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { activeState, layout, renderSvg, skippingFrames } from "../js/diagram.js";
import { choiceOptions, validate } from "../js/form-logic.js";
import { normalize } from "../js/model.js";

const def = JSON.parse(
  readFileSync(new URL("../../backend/questionnaires/system-basic.v5.json", import.meta.url), "utf-8"),
);
const Q = Object.fromEntries(def.questions.map((q) => [q.id, q]));
const STEP = Object.fromEntries(Q.skipping.item.map((q) => [q.id, q]));
const OUT = Q.connections.item[2].options[0];
const [OFF, ON] = STEP.action.options;

// ePO-like: Core runs in Ofek; the Core in Sapir is on standby. Skipping turns Ofek's off and Sapir's on.
const GOOD = {
  system_name: "ePO",
  primary_site: "Ofek",
  segments: [{ name: "Core", subnet: "10.1.1.0/24" }, { name: "App", subnet: "10.1.2.0/24" }],
  servers: [
    { name: "core-1", role: "app", os: "Windows", segment: "Core", standby: false },
    { name: "app-1", role: "app", os: "Windows", segment: "App", standby: false },
  ],
  other_sites: [{
    site: "Sapir",
    segments: [{ name: "Core", subnet: "10.2.1.0/24" }],
    servers: [{ name: "core-1", role: "app", os: "Windows", segment: "Core", standby: true }],
  }],
  dr_site: "Sapir",
  connections: [
    { from: ["App (Ofek)"], to: ["Core (Ofek)", "Core (Sapir)"], direction: OUT, protocol: "HTTPS", ports: "443" },
    { from: ["Core (Ofek)", "Core (Sapir)"], to: ["All endpoints"], direction: OUT, protocol: "TCP", ports: "8080" },
  ],
  skipping: [
    { action: OFF, server: "core-1 (Ofek)", note: "stop the service first" },
    { action: ON, server: "core-1 (Sapir)" },
  ],
};
const copy = () => structuredClone(GOOD);

test("the file: standby on servers, skipping last", () => {
  assert.equal(def.questions.at(-1).id, "skipping");
  assert.equal(def.questions.at(-2).id, "connections");
  assert.equal(Q.servers.item.at(-1).id, "standby");
  assert.deepEqual([OFF, ON], ["Turn off a server", "Turn on a server"]);
});

test("the answers are valid, and a step picks a server of any site", () => {
  assert.deepEqual(validate(def.questions, GOOD), []);
  const frames = [{ questions: Q.skipping.item, row: GOOD.skipping[0] }];
  assert.deepEqual(choiceOptions(STEP.server, GOOD, frames), ["core-1 (Ofek)", "app-1 (Ofek)", "core-1 (Sapir)"]);
  const a = copy();
  delete a.skipping[1].action;
  assert.deepEqual(validate(def.questions, a), [{ path: "skipping[1].action", message: "This answer is required" }]);
});

test("the model: standby servers are off, steps name servers by key", () => {
  const m = normalize(GOOD);
  assert.deepEqual(m.servers.filter((s) => s.off).map((s) => s.key), ["core-1 (Sapir)"]);
  assert.deepEqual(m.skipping, [
    { action: "off", server: "core-1 (Ofek)", note: "stop the service first" },
    { action: "on", server: "core-1 (Sapir)", note: "" },
  ]);
  const a = copy();
  a.skipping.push({ action: ON, server: "old-1 (Ofek)" }); // a server that is gone
  assert.equal(normalize(a).skipping.length, 2);
  assert.deepEqual(normalize({ system_name: "x" }).skipping, []);
});

// connections in the model: 0 App->Core(Ofek), 1 App->Core(Sapir), 2 Core(Ofek)->endpoints, 3 Core(Sapir)->endpoints
test("what a standby server leaves unused is grey, but still there", () => {
  const m = normalize(GOOD);
  const s = activeState(m);
  assert.deepEqual([...s.offServers], ["core-1 (Sapir)"]);
  assert.deepEqual([...s.idleSegments], ["Core (Sapir)"]);
  assert.deepEqual([...s.idleConnections], [1, 3]);
  const svg = renderSvg([m], { showSystems: false });
  assert.equal((svg.match(/class="conn idle"/g) || []).length, 2);
  assert.equal((svg.match(/class="conn"/g) || []).length, 2);
  assert.match(svg, /class="srv off" data-key="core-1 \(Sapir\)"/);
  // a segment keeps working while one of its servers is still on
  const two = normalize({ ...copy(), servers: [...GOOD.servers, { name: "core-2", segment: "Core", standby: true }] });
  assert.deepEqual([...activeState(two, ["core-2 (Ofek)", "core-1 (Sapir)"]).idleConnections], [1, 3]);
});

test("skipping moves the communication from Ofek's Core to Sapir's", () => {
  const frames = skippingFrames(normalize(GOOD));
  assert.equal(frames.length, 3);
  assert.deepEqual([...frames[0].idleConnections], [1, 3]);
  assert.match(frames[0].caption, /core-1 \(Sapir\) is turned off/);
  // 1. Ofek's Core is turned off: what used it stops
  assert.deepEqual(frames[1].stopped, [0, 2]);
  assert.deepEqual(frames[1].started, []);
  assert.match(frames[1].caption, /^Step 1 of 2: Turn off core-1 \(Ofek\)\. stop the service first\. Stops: App \(Ofek\) → Core \(Ofek\)/);
  // 2. Sapir's Core is turned on: its communication starts
  assert.deepEqual(frames[2].started, [1, 3]);
  assert.deepEqual([...frames[2].idleConnections].sort(), [0, 2]);
  assert.deepEqual([...frames[2].offServers], ["core-1 (Ofek)"]);
});

test("the picture does not move during skipping", () => {
  const m = normalize(GOOD);
  const L = layout([m], { showSystems: false });
  // every connection is drawn, with the index the animation uses
  assert.deepEqual(L.connections.map((c) => c.index).sort(), [0, 1, 2, 3]);
  const off = normalize({ ...copy(), servers: GOOD.servers.map((s) => ({ ...s, standby: true })) });
  const L2 = layout([off], { showSystems: false });
  assert.deepEqual(L2.servers.map((s) => [s.x, s.y]), L.servers.map((s) => [s.x, s.y]));
  assert.deepEqual(L2.connections.map((c) => c.d), L.connections.map((c) => c.d));
});
