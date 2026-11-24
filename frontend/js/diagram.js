// Draws the architecture as SVG, with no libraries (works fully offline).
// Input: the normalized models from GET /api/model:
//   [{ system, sites: [..], servers: [{name, site, role, os}], links: [{to, protocol}],
//      connections: [{from, to, protocol, ports}] }]   (connections are between this system's servers)

const ROLE_COLORS = {
  web: "#2f7dd1",
  app: "#2a9d6f",
  database: "#c9772b",
  storage: "#8a5fc7",
  other: "#7a8594",
};
export const ROLES = Object.keys(ROLE_COLORS);
export const roleColor = (role) => ROLE_COLORS[role] || ROLE_COLORS.other;

// The special "server" for traffic to or from all endpoints. Same text in backend/app/core/normalize.py.
export const ENDPOINTS = "All endpoints";
const CONN_COLOR = "#0f766e";

const G = {
  margin: 30,
  sysW: 150, sysH: 44, sysGap: 36,
  siteW: 230, siteGap: 36, siteHead: 38, sitePad: 14, emptySiteBody: 40,
  srvH: 44, srvGap: 10,
  bandGap: 90, // vertical space between the systems row and the sites row
  arcBase: 30, arcStep: 22,
  siteGapConn: 150, // wider gaps between sites when server connections are drawn there
  loopBase: 28, loopStep: 16, // how far a connection inside one column bulges out
  laneGap: 26, laneStep: 24, // connections that skip a column run in lanes under the sites
};

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(text, maxChars) {
  const s = String(text);
  return s.length <= maxChars ? s : s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

const round = (n) => Math.round(n * 10) / 10;

// Pure geometry: decides where everything goes.
// showSystems: false leaves out the row of system names (and the arrows between systems): used when
// the picture shows one system and its name is already the title above it.
export function layout(models, { showSystems = true } = {}) {
  // Systems: the described ones first, then systems that are only mentioned as link targets.
  const systems = [];
  const systemByName = new Map();
  const addSystem = (name, described) => {
    if (!systemByName.has(name)) {
      const s = { name, described, index: systems.length };
      systemByName.set(name, s);
      systems.push(s);
    } else if (described) {
      systemByName.get(name).described = true;
    }
  };
  models.forEach((m) => addSystem(m.system, true));
  models.forEach((m) => (m.links || []).forEach((l) => addSystem(l.to, false)));

  // Sites with their servers (a site can also exist without servers, e.g. a DR site).
  const siteServers = new Map();
  models.forEach((m) =>
    (m.servers || []).forEach((s) => {
      if (!siteServers.has(s.site)) siteServers.set(s.site, []);
      siteServers.get(s.site).push({ system: m.system, name: s.name, role: s.role || "other", os: s.os || "" });
    }),
  );
  models.forEach((m) => (m.sites || []).forEach((n) => { if (!siteServers.has(n)) siteServers.set(n, []); }));
  const siteNames = [...siteServers.keys()].sort((a, b) => a.localeCompare(b));
  siteNames.forEach((n) =>
    siteServers.get(n).sort(
      (a, b) => systemByName.get(a.system).index - systemByName.get(b.system).index || a.name.localeCompare(b.name),
    ),
  );

  const drSites = new Set(models.map((m) => m.dr_site).filter(Boolean));

  // Columns: the real sites, then one "Endpoints" column per system that has connections to endpoints.
  const columns = siteNames.map((name) => ({ name, list: siteServers.get(name), endpoints: false }));
  models.forEach((m) => {
    if ((m.connections || []).some((c) => c.from === ENDPOINTS || c.to === ENDPOINTS)) {
      columns.push({
        name: models.length > 1 ? `Endpoints (${m.system})` : "Endpoints",
        list: [{ system: m.system, name: ENDPOINTS, role: "", os: "" }],
        endpoints: true,
      });
    }
  });
  const hasConnections = models.some((m) => (m.connections || []).length > 0);
  const siteGap = hasConnections ? G.siteGapConn : G.siteGap;

  const shown = showSystems ? systems : [];

  // Row widths, then centre the narrower row under the wider one.
  const sysRowW = shown.length * G.sysW + Math.max(0, shown.length - 1) * G.sysGap;
  const siteRowW = columns.length * G.siteW + Math.max(0, columns.length - 1) * siteGap;
  const contentW = Math.max(sysRowW, siteRowW, showSystems ? G.sysW : G.siteW);
  let width = contentW + 2 * G.margin;

  // Links drawn as arcs above the systems row; farther apart = higher arc.
  const arcHeight = (a, b, reverse) =>
    G.arcBase + G.arcStep * (Math.abs(a.index - b.index) - 1) + (reverse ? 30 : 0);
  const rawLinks = [];
  if (showSystems) models.forEach((m) =>
    (m.links || []).forEach((l) => {
      const from = systemByName.get(m.system);
      const to = systemByName.get(l.to);
      if (from && to && from !== to) rawLinks.push({ from, to, protocol: l.protocol || "" });
    }),
  );
  const maxArc = rawLinks.reduce((mx, l) => Math.max(mx, arcHeight(l.from, l.to, l.from.index > l.to.index)), 0);
  const band = rawLinks.length ? maxArc + 36 : 10;

  const sysY = G.margin + band;
  const sysX0 = G.margin + (contentW - sysRowW) / 2;
  systems.forEach((s) => Object.assign(s, { x: sysX0 + s.index * (G.sysW + G.sysGap), y: sysY, w: G.sysW, h: G.sysH }));

  const sitesY = showSystems ? sysY + G.sysH + G.bandGap : G.margin;
  const siteX0 = G.margin + (contentW - siteRowW) / 2;
  const sites = [];
  const servers = [];
  columns.forEach(({ name, list, endpoints }, k) => {
    const body = list.length
      ? list.length * G.srvH + (list.length - 1) * G.srvGap + 2 * G.sitePad
      : G.emptySiteBody;
    const site = { name, endpoints, dr: !endpoints && drSites.has(name), empty: list.length === 0, x: siteX0 + k * (G.siteW + siteGap), y: sitesY, w: G.siteW, h: G.siteHead + body };
    sites.push(site);
    list.forEach((s, i) =>
      servers.push({
        ...s,
        site: name,
        endpoints,
        col: k,
        x: site.x + G.sitePad,
        y: site.y + G.siteHead + G.sitePad + i * (G.srvH + G.srvGap),
        w: G.siteW - 2 * G.sitePad,
        h: G.srvH,
      }),
    );
  });
  const maxSiteH = sites.reduce((mx, s) => Math.max(mx, s.h), 0);
  let height = sitesY + maxSiteH + G.margin;

  // System -> site connectors: one thin line per (system, site) pair that ends on the site's top edge,
  // so lines never cut through server cards. Several lines into one site are spread along its edge.
  const edges = [];
  sites.forEach((site) => {
    if (site.endpoints || !showSystems) return; // endpoints are not a place where the system has servers
    const owners = [...new Set(servers.filter((s) => s.site === site.name).map((s) => s.system))].sort(
      (a, b) => systemByName.get(a).index - systemByName.get(b).index,
    );
    owners.forEach((name, j) => {
      const sys = systemByName.get(name);
      edges.push({
        system: name,
        site: site.name,
        x1: sys.x + sys.w / 2,
        y1: sys.y + sys.h,
        x2: site.x + (site.w * (j + 1)) / (owners.length + 1),
        y2: site.y,
      });
    });
  });

  // System -> system arrows.
  const links = rawLinks.map((l) => {
    const h = arcHeight(l.from, l.to, l.from.index > l.to.index);
    const x1 = l.from.x + l.from.w / 2;
    const x2 = l.to.x + l.to.w / 2;
    const y = sysY;
    return {
      from: l.from.name, to: l.to.name, protocol: l.protocol,
      d: `M ${round(x1)} ${y} Q ${round((x1 + x2) / 2)} ${round(y - 2 * h)} ${round(x2)} ${y}`,
      labelX: round((x1 + x2) / 2), labelY: round(y - h - 5),
    };
  });

  // Server -> server connections, drawn between the sides of the server cards.
  const cardOf = (system, name) => servers.find((s) => s.system === system && s.name === name);
  const raw = [];
  models.forEach((m) =>
    (m.connections || []).forEach((c) => {
      const a = cardOf(m.system, c.from);
      const b = cardOf(m.system, c.to);
      if (!a || !b || a === b) return; // unknown server or a server talking to itself: listed in the table only
      const sameColumn = a.col === b.col;
      const viaLane = Math.abs(a.col - b.col) > 1; // would cross other columns: go underneath them
      const sideA = sameColumn || b.col > a.col ? "right" : "left";
      const sideB = sameColumn ? "right" : b.col > a.col ? "left" : "right";
      raw.push({ system: m.system, ...c, a, b, sideA, sideB, sameColumn, viaLane });
    }),
  );
  // Several connections on the same side of one card are spread along that side.
  const slots = new Map();
  const slot = (card, side) => {
    const key = `${card.system}\u0000${card.name}\u0000${side}`;
    if (!slots.has(key)) slots.set(key, { card, n: 0 });
    const entry = slots.get(key);
    return { entry, k: entry.n++ };
  };
  const ends = raw.map((r) => ({ from: slot(r.a, r.sideA), to: slot(r.b, r.sideB) }));
  const loopsPerColumn = new Map();
  const sitesBottom = sitesY + maxSiteH;
  let lanes = 0;
  const connections = raw.map((r, i) => {
    const pos = ({ entry, k }, side) => ({
      x: side === "right" ? entry.card.x + entry.card.w : entry.card.x,
      y: entry.card.y + (entry.card.h * (k + 1)) / (entry.n + 1),
    });
    const p0 = pos(ends[i].from, r.sideA);
    const p3 = pos(ends[i].to, r.sideB);
    const label = [r.protocol, r.ports].filter(Boolean).join(" ");
    const labelW = Math.min(label.length, 30) * 6.5;
    const dir = (side) => (side === "right" ? 1 : -1);
    if (r.viaLane) {
      // Out of the card into the gap beside its site, down under all sites, across, and up into the target.
      const laneY = sitesBottom + G.laneGap + G.laneStep * lanes++;
      const xa = p0.x + dir(r.sideA) * (G.sitePad + siteGap / 3);
      const xb = p3.x + dir(r.sideB) * (G.sitePad + siteGap / 3);
      height = Math.max(height, laneY + G.margin);
      return {
        system: r.system, from: r.from, to: r.to, both: !!r.both, protocol: r.protocol || "", ports: r.ports || "", label,
        d: `M ${round(p0.x)} ${round(p0.y)} L ${round(xa)} ${round(p0.y)} L ${round(xa)} ${round(laneY)} ` +
          `L ${round(xb)} ${round(laneY)} L ${round(xb)} ${round(p3.y)} L ${round(p3.x)} ${round(p3.y)}`,
        labelX: round((xa + xb) / 2), labelY: round(laneY - 6), anchor: "middle",
      };
    }
    let p1, p2;
    if (r.sameColumn) {
      const n = loopsPerColumn.get(r.a.x) || 0;
      loopsPerColumn.set(r.a.x, n + 1);
      const bulge = G.loopBase + G.loopStep * n + (r.a.endpoints ? 0 : G.sitePad);
      p1 = { x: p0.x + bulge, y: p0.y };
      p2 = { x: p3.x + bulge, y: p3.y };
    } else {
      const d = Math.max(40, Math.abs(p3.x - p0.x) / 2);
      p1 = { x: p0.x + dir(r.sideA) * d, y: p0.y };
      p2 = { x: p3.x + dir(r.sideB) * d, y: p3.y };
    }
    // Label at the middle of the curve.
    const mid = (k) => (p0[k] + 3 * p1[k] + 3 * p2[k] + p3[k]) / 8;
    // Beside a loop, or just above a curve between two columns.
    const labelX = r.sameColumn ? mid("x") + 4 : mid("x");
    const labelY = r.sameColumn ? mid("y") + 4 : mid("y") - 6;
    const anchor = r.sameColumn ? "start" : "middle";
    // Grow the picture if a loop or its label reaches past the right edge.
    const right = Math.max(p1.x, p2.x, anchor === "start" ? labelX + labelW : labelX + labelW / 2);
    width = Math.max(width, right + G.margin);
    return {
      system: r.system, from: r.from, to: r.to, both: !!r.both, protocol: r.protocol || "", ports: r.ports || "", label,
      d: `M ${round(p0.x)} ${round(p0.y)} C ${round(p1.x)} ${round(p1.y)} ${round(p2.x)} ${round(p2.y)} ${round(p3.x)} ${round(p3.y)}`,
      labelX: round(labelX), labelY: round(labelY), anchor,
    };
  });

  return { width: round(width), height: round(height), systems: shown, sites, servers, edges, links, connections };
}

// Turns the layout into an SVG string. Colours are inline so the exported file looks the same everywhere.
// options: { showSystems } (see layout) and { background: false } for a see-through picture (the app
// draws a dotted canvas behind it). Downloaded files keep the default white background.
export function renderSvg(models, options = {}) {
  if (!models || !models.length) return null;
  const L = layout(models, options);
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-size="13" role="img" aria-label="Systems architecture diagram">`,
  );
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="#3b4a5e"/></marker>` +
      `<marker id="arrow-conn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${CONN_COLOR}"/></marker></defs>`,
  );
  if (options.background !== false) out.push(`<rect width="${L.width}" height="${L.height}" fill="#ffffff"/>`);

  for (const s of L.sites) {
    out.push(
      `<g><title>${escapeXml(s.name)}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="10" ` +
        (s.endpoints ? `fill="#eef7f5" stroke="${CONN_COLOR}" stroke-dasharray="6 4"` : `fill="#f5f7fa" stroke="#aab4c2"${s.empty ? ' stroke-dasharray="6 4"' : ""}`) +
        `/>` +
        `<text x="${s.x + 14}" y="${s.y + 24}" font-weight="700" fill="#1c2733">${escapeXml(truncate(s.endpoints ? s.name : "Site: " + s.name, s.dr ? 22 : 28))}</text>` +
        (s.dr ? `<text x="${s.x + s.w - 14}" y="${s.y + 24}" text-anchor="end" font-size="11" font-weight="700" fill="#b45309">DR</text>` : "") +
        (s.empty ? `<text x="${s.x + 14}" y="${s.y + 56}" fill="#7a8594" font-style="italic">no servers described</text>` : "") +
        `</g>`,
    );
  }

  for (const e of L.edges) {
    out.push(
      `<g><title>${escapeXml(`${e.system} has servers in ${e.site}`)}</title>` +
        `<line x1="${round(e.x1)}" y1="${round(e.y1)}" x2="${round(e.x2)}" y2="${round(e.y2)}" stroke="#9aa6b5" stroke-dasharray="4 4"/>` +
        `<circle cx="${round(e.x2)}" cy="${round(e.y2)}" r="3.5" fill="#9aa6b5"/></g>`,
    );
  }

  for (const s of L.servers) {
    const detail = [s.role, s.os].filter(Boolean).join(" · ");
    out.push(
      `<g><title>${escapeXml(`${s.name}${L.systems.length ? ` (${s.system})` : ""}${detail ? " – " + detail : ""}`)}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" fill="#ffffff" stroke="#c3cbd6"/>` +
        `<rect x="${s.x}" y="${s.y}" width="6" height="${s.h}" rx="3" fill="${roleColor(s.role)}"/>` +
        `<text x="${s.x + 16}" y="${s.y + 19}" font-weight="600" fill="#1c2733">${escapeXml(truncate(s.name, 24))}</text>` +
        `<text x="${s.x + 16}" y="${s.y + 35}" font-size="11" fill="#5d6b7b">${escapeXml(truncate(L.systems.length ? `${s.system}${detail ? " · " + detail : ""}` : detail, 32))}</text>` +
        `</g>`,
    );
  }

  for (const c of L.connections) {
    out.push(
      `<g><title>${escapeXml(`${c.from} ${c.both ? "↔" : "→"} ${c.to}${c.label ? ": " + c.label : ""}`)}</title>` +
        `<path d="${c.d}" fill="none" stroke="${CONN_COLOR}" stroke-width="1.6" marker-end="url(#arrow-conn)"${c.both ? ' marker-start="url(#arrow-conn)"' : ""}/>` +
        (c.label
          ? `<text x="${c.labelX}" y="${c.labelY}" text-anchor="${c.anchor}" font-size="11" fill="${CONN_COLOR}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(truncate(c.label, 30))}</text>`
          : "") +
        `</g>`,
    );
  }

  for (const l of L.links) {
    out.push(
      `<g><title>${escapeXml(`${l.from} → ${l.to}${l.protocol ? " (" + l.protocol + ")" : ""}`)}</title>` +
        `<path d="${l.d}" fill="none" stroke="#3b4a5e" stroke-width="1.6" marker-end="url(#arrow)"/>` +
        (l.protocol
          ? `<text x="${l.labelX}" y="${l.labelY}" text-anchor="middle" font-size="11" fill="#3b4a5e" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(truncate(l.protocol, 26))}</text>`
          : "") +
        `</g>`,
    );
  }

  for (const s of L.systems) {
    const textColor = s.described ? "#ffffff" : "#1f3a5f";
    out.push(
      `<g><title>${escapeXml(s.name + (s.described ? "" : " (not described yet)"))}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.h / 2}" ` +
        (s.described ? `fill="#1f3a5f" stroke="#1f3a5f"` : `fill="#ffffff" stroke="#1f3a5f" stroke-dasharray="5 4"`) +
        `/>` +
        `<text x="${s.x + s.w / 2}" y="${s.y + (s.described ? s.h / 2 + 5 : 20)}" text-anchor="middle" font-weight="600" fill="${textColor}">${escapeXml(truncate(s.name, 18))}</text>` +
        (s.described ? "" : `<text x="${s.x + s.w / 2}" y="${s.y + 35}" text-anchor="middle" font-size="10" font-style="italic" fill="#5d6b7b">not described yet</text>`) +
        `</g>`,
    );
  }

  out.push("</svg>");
  return out.join("\n");
}
