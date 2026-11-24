// Answers -> the common model, in the browser, for the live diagram next to the form.
// Mirrors backend/app/core/normalize.py (keep the two in step). The server's version is the one that
// is saved; this one only has to cope with answers that are still being typed.

import { ENDPOINTS } from "./diagram.js";

export const NO_SITE = "(no site yet)";
// The first option of the DR question in questionnaire v2. Same text in backend/app/core/normalize.py.
export const NO_DR = "No DR site";

const text = (v) => (typeof v === "string" ? v.trim() : "");

function connection(server, c) {
  const other = text(c.to);
  const direction = text(c.direction).toLowerCase();
  const incoming = direction.startsWith("incoming");
  return {
    from: incoming ? other : server,
    to: incoming ? server : other,
    both: direction.startsWith("both"),
    protocol: text(c.protocol),
    ports: text(c.ports),
  };
}

// The same connection described from both of its ends counts once.
function same(a, b) {
  if (a.both !== b.both || a.protocol !== b.protocol || a.ports !== b.ports) return false;
  if (a.both) return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
  return a.from === b.from && a.to === b.to;
}

// (row, site) for every server: the primary site's servers, then servers in other sites.
// Older answers (questionnaire v1) give a site per server and have no primary site.
function serverRows(answers) {
  const primary = text(answers.primary_site);
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const rows = list(answers.servers).map((row) => [row, text(row.site) || primary]);
  if (answers.has_other_sites) list(answers.other_servers).forEach((row) => rows.push([row, text(row.site)]));
  return rows;
}

function drSite(answers) {
  if ("has_dr" in answers) return answers.has_dr ? text(answers.dr_site) : ""; // v1: yes/no, then typed in
  const dr = text(answers.dr_site); // v2: a dropdown that starts with "No DR site"
  return dr === NO_DR ? "" : dr;
}

export function normalize(answers) {
  const rows = serverRows(answers).filter(([row]) => text(row.name)); // a server needs a name before it can be drawn

  const servers = rows.map(([row, site]) => ({
    name: text(row.name),
    site: site || NO_SITE,
    role: row.role || "other",
    os: row.os || "",
  }));

  const connections = [];
  for (const [row] of rows) {
    if (!row.has_connections) continue;
    for (const c of Array.isArray(row.connections) ? row.connections : []) {
      if (!c || !text(c.to)) continue;
      const conn = connection(text(row.name), c);
      if (!connections.some((other) => same(conn, other))) connections.push(conn);
    }
  }

  const dr = drSite(answers);
  const sites = new Set(servers.map((s) => s.site));
  for (const extra of [text(answers.primary_site), dr]) if (extra) sites.add(extra);

  const links = (Array.isArray(answers.depends_on) ? answers.depends_on : [])
    .filter((row) => row && text(row.system))
    .map((row) => ({ to: text(row.system), protocol: row.protocol || "" }));

  return {
    system: text(answers.system_name),
    servers,
    sites: [...sites].sort(),
    dr_site: dr,
    links,
    connections,
  };
}
