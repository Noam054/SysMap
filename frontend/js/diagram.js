// Draws the architecture as SVG, with no libraries (works fully offline).
// Input: the normalized models from GET /api/model:
//   [{ system, sites: [..], servers: [{name, site, role, os}], links: [{to, protocol}] }]

const ROLE_COLORS = {
  web: "#2f7dd1",
  app: "#2a9d6f",
  database: "#c9772b",
  storage: "#8a5fc7",
  other: "#7a8594",
};
export const ROLES = Object.keys(ROLE_COLORS);
export const roleColor = (role) => ROLE_COLORS[role] || ROLE_COLORS.other;

const G = {
  margin: 30,
  sysW: 150, sysH: 44, sysGap: 36,
  siteW: 230, siteGap: 36, siteHead: 38, sitePad: 14, emptySiteBody: 40,
  srvH: 44, srvGap: 10,
  bandGap: 90, // vertical space between the systems row and the sites row
  arcBase: 30, arcStep: 22,
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
export function layout(models) {
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

  // Row widths, then centre the narrower row under the wider one.
  const sysRowW = systems.length * G.sysW + Math.max(0, systems.length - 1) * G.sysGap;
  const siteRowW = siteNames.length * G.siteW + Math.max(0, siteNames.length - 1) * G.siteGap;
  const contentW = Math.max(sysRowW, siteRowW, G.sysW);
  const width = contentW + 2 * G.margin;

  // Links drawn as arcs above the systems row; farther apart = higher arc.
  const arcHeight = (a, b, reverse) =>
    G.arcBase + G.arcStep * (Math.abs(a.index - b.index) - 1) + (reverse ? 30 : 0);
  const rawLinks = [];
  models.forEach((m) =>
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

  const sitesY = sysY + G.sysH + G.bandGap;
  const siteX0 = G.margin + (contentW - siteRowW) / 2;
  const sites = [];
  const servers = [];
  siteNames.forEach((name, k) => {
    const list = siteServers.get(name);
    const body = list.length
      ? list.length * G.srvH + (list.length - 1) * G.srvGap + 2 * G.sitePad
      : G.emptySiteBody;
    const site = { name, empty: list.length === 0, x: siteX0 + k * (G.siteW + G.siteGap), y: sitesY, w: G.siteW, h: G.siteHead + body };
    sites.push(site);
    list.forEach((s, i) =>
      servers.push({
        ...s,
        site: name,
        x: site.x + G.sitePad,
        y: site.y + G.siteHead + G.sitePad + i * (G.srvH + G.srvGap),
        w: G.siteW - 2 * G.sitePad,
        h: G.srvH,
      }),
    );
  });
  const maxSiteH = sites.reduce((mx, s) => Math.max(mx, s.h), 0);
  const height = sitesY + maxSiteH + G.margin;

  // System -> site connectors: one thin line per (system, site) pair that ends on the site's top edge,
  // so lines never cut through server cards. Several lines into one site are spread along its edge.
  const edges = [];
  sites.forEach((site) => {
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

  return { width: round(width), height: round(height), systems, sites, servers, edges, links };
}

// Turns the layout into an SVG string. Colours are inline so the exported file looks the same everywhere.
export function renderSvg(models) {
  if (!models || !models.length) return null;
  const L = layout(models);
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-size="13" role="img" aria-label="Systems architecture diagram">`,
  );
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="#3b4a5e"/></marker></defs>`,
  );
  out.push(`<rect width="${L.width}" height="${L.height}" fill="#ffffff"/>`);

  for (const s of L.sites) {
    out.push(
      `<g><title>${escapeXml(s.name)}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="10" fill="#f5f7fa" stroke="#aab4c2"${s.empty ? ' stroke-dasharray="6 4"' : ""}/>` +
        `<text x="${s.x + 14}" y="${s.y + 24}" font-weight="700" fill="#1c2733">${escapeXml(truncate("Site: " + s.name, 28))}</text>` +
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
      `<g><title>${escapeXml(`${s.name} (${s.system}) – ${detail}`)}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" fill="#ffffff" stroke="#c3cbd6"/>` +
        `<rect x="${s.x}" y="${s.y}" width="6" height="${s.h}" rx="3" fill="${roleColor(s.role)}"/>` +
        `<text x="${s.x + 16}" y="${s.y + 19}" font-weight="600" fill="#1c2733">${escapeXml(truncate(s.name, 24))}</text>` +
        `<text x="${s.x + 16}" y="${s.y + 35}" font-size="11" fill="#5d6b7b">${escapeXml(truncate(`${s.system}${detail ? " · " + detail : ""}`, 32))}</text>` +
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
