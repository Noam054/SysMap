// Answers -> the common model, in the browser, for the live diagram next to the form.
// Mirrors backend/app/core/normalize.py (keep the two in step). The server's version is the one that
// is saved; this one only has to cope with answers that are still being typed.

import { cidr, ipv4Text } from "./form-logic.js";

export const NO_SITE = "(no site yet)";
// The first option of the DR question (v2 and later). Same text in backend/app/core/normalize.py.
export const NO_DR = "No DR site";

const text = (v) => (typeof v === "string" ? v.trim() : "");
const rows = (v) => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object") : []);

// One name, or several picked at once (v4: "From" and "To" may each list several segments).
const names = (v) => (Array.isArray(v) ? v : [v]).map(text).filter(Boolean);

// One answer about a connection -> one connection per pair of ends.
// sources: the names it is described from ("From" since v3, the server itself in v2).
function connections(sources, c) {
  const direction = text(c.direction).toLowerCase();
  const incoming = direction.startsWith("incoming");
  return sources.flatMap((source) => names(c.to).map((other) => ({
    from: incoming ? other : source,
    to: incoming ? source : other,
    both: direction.startsWith("both"),
    protocol: text(c.protocol),
    ports: text(c.ports),
  })));
}

// The same connection described from both of its ends counts once.
function same(a, b) {
  if (a.both !== b.both || a.protocol !== b.protocol || a.ports !== b.ports) return false;
  if (a.both) return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
  return a.from === b.from && a.to === b.to;
}

// [answers of one site, site name]: the top level is the primary site, then each "Add site" block (v3).
function siteBlocks(answers) {
  return [[answers, text(answers.primary_site)], ...rows(answers.other_sites).map((b) => [b, text(b.site)])];
}

// " 14.151.0.0 / 24 " -> "14.151.0.0/24" (tidied); text that is not a valid subnet is kept as typed.
export function subnet(value) {
  const parsed = cidr(value);
  return parsed ? `${ipv4Text(parsed[0])}/${parsed[1]}` : text(value);
}

function drSite(answers) {
  if ("has_dr" in answers) return answers.has_dr ? text(answers.dr_site) : ""; // v1: yes/no, then typed in
  const dr = text(answers.dr_site); // v2 and later: a dropdown that starts with "No DR site"
  return dr === NO_DR ? "" : dr;
}

// How a server or segment is named in connections and in the model: "DB (Sapir)". Two sites may both have a
// segment (or a server) called "DB"; the site tells them apart. Same text as the questionnaire's options_from
// label. A server and a segment of one site never share a name (the "not_in" rule).
export const nodeKey = (name, site) => `${name} (${site || "?"})`;

export function normalize(answers) {
  const segments = [];
  const serverRows = [];
  const raw = []; // [from, answer, site of the block it was given in]
  const result = [];

  for (const [block, site] of siteBlocks(answers)) {
    for (const row of rows(block.segments)) {
      if (!text(row.name)) continue; // a segment needs a name before it can be drawn
      segments.push({ name: text(row.name), site: site || NO_SITE, subnet: subnet(row.subnet), key: nodeKey(text(row.name), site) });
    }
    for (const row of rows(block.servers)) serverRows.push([row, text(row.site) || site]);
    for (const c of rows(block.connections)) raw.push([names(c.from), c, site]); // v3: each site's own; v4: one list for all
  }
  if (answers.has_other_sites) rows(answers.other_servers).forEach((row) => serverRows.push([row, text(row.site)])); // v2

  const servers = [];
  for (const [row, site] of serverRows) {
    if (!text(row.name)) continue; // a server needs a name before it can be drawn
    servers.push({
      name: text(row.name), site: site || NO_SITE, role: row.role || "other", os: row.os || "",
      segment: text(row.segment), key: nodeKey(text(row.name), site),
    });
    if (row.has_connections) rows(row.connections).forEach((c) => raw.push([names(row.name), c, site])); // v2
  }

  // A connection end -> a server or segment key ("DB (Sapir)"), or "All endpoints".
  // v3 answers name a server or segment without its site: the one in the connection's own site, else the
  // only one with that name.
  const nodes = [...servers, ...segments]; // servers first: in older answers a plain name means the server
  const keys = new Set(nodes.map((n) => n.key));
  const end = (value, site) => {
    if (keys.has(value) || value === "All endpoints") return value;
    const sameName = nodes.filter((g) => g.name === value);
    const here = sameName.filter((g) => g.site === (site || NO_SITE));
    return here.length ? here[0].key : sameName.length === 1 ? sameName[0].key : value;
  };
  for (const [sources, c, site] of raw) {
    for (const conn of connections(sources, c)) {
      conn.from = end(conn.from, site);
      conn.to = end(conn.to, site);
      if (conn.from !== conn.to && !result.some((other) => same(conn, other))) result.push(conn);
    }
  }

  const dr = drSite(answers);
  const sites = new Set([...servers.map((s) => s.site), ...segments.map((s) => s.site)]);
  for (const extra of [text(answers.primary_site), dr, ...siteBlocks(answers).map(([, s]) => s)]) if (extra) sites.add(extra);

  const links = rows(answers.depends_on)
    .filter((row) => text(row.system))
    .map((row) => ({ to: text(row.system), protocol: row.protocol || "" }));

  return {
    system: text(answers.system_name),
    servers,
    segments,
    sites: [...sites].sort(),
    dr_site: dr,
    links,
    connections: result,
  };
}
