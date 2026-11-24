import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isVisible, parseServerErrors, pruneHidden, validate } from "../js/form-logic.js";

const def = JSON.parse(
  readFileSync(new URL("../../backend/questionnaires/system-basic.v1.json", import.meta.url), "utf-8"),
);
const Q = def.questions;

const GOOD = {
  system_name: "Billing",
  server_count: 2,
  servers: [
    { name: "bill-app-1", site: "Haifa", role: "app" },
    { name: "bill-db-1", site: "Haifa", role: "database" },
  ],
  depends_on: [{ system: "Auth", protocol: "LDAPS/636" }],
  has_dr: true,
  dr_site: "Beer Sheva",
};

test("valid answers produce no errors", () => {
  assert.deepEqual(validate(Q, GOOD), []);
});

test("show_if hides and shows a question", () => {
  const drSite = Q.find((q) => q.id === "dr_site");
  assert.equal(isVisible(drSite, { has_dr: true }), true);
  assert.equal(isVisible(drSite, { has_dr: false }), false);
  assert.equal(isVisible(drSite, {}), false);
});

test("required questions are reported with their path", () => {
  const paths = validate(Q, {}).map((e) => e.path);
  assert.ok(paths.includes("system_name"));
  assert.ok(paths.includes("server_count"));
});

test("a hidden required question is not required", () => {
  const answers = { ...GOOD, has_dr: false };
  delete answers.dr_site;
  assert.deepEqual(validate(Q, answers), []);
  const missing = { ...GOOD };
  delete missing.dr_site;
  assert.ok(validate(Q, missing).some((e) => e.path === "dr_site"));
});

test("errors inside list rows use the same path format as the server", () => {
  const errors = validate(Q, { ...GOOD, servers: [{ name: "x" }] });
  assert.ok(errors.some((e) => e.path === "servers[0].site"));
});

test("wrong types and ranges", () => {
  assert.ok(validate(Q, { ...GOOD, server_count: "two" }).some((e) => e.path === "server_count"));
  assert.ok(validate(Q, { ...GOOD, server_count: -1 }).some((e) => e.path === "server_count"));
  assert.ok(validate(Q, { ...GOOD, servers: [{ name: "a", site: "b", role: "toaster" }] }).some((e) => e.path === "servers[0].role"));
});

test("pruneHidden drops hidden answers and blank rows but keeps false", () => {
  const pruned = pruneHidden(Q, {
    system_name: "Billing",
    has_dr: false,
    dr_site: "left over",
    servers: [{}, { name: "a", site: "b" }, {}],
    depends_on: [{}],
  });
  assert.deepEqual(pruned, {
    system_name: "Billing",
    has_dr: false,
    servers: [{ name: "a", site: "b" }],
  });
});

test("server error strings are split into path and message", () => {
  assert.deepEqual(parseServerErrors(["servers[0].site: is required", "plain"]), [
    { path: "servers[0].site", message: "is required" },
    { path: "", message: "plain" },
  ]);
});
