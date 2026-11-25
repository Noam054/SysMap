// Draws the architecture as SVG, with no libraries (works fully offline).
// Input: the normalized models from GET /api/model:
//   [{ system, sites: [..], dr_site, segments: [{name, site, subnet, key}], servers: [{name, site, role, os, segment}],
//      links: [{to, protocol}], connections: [{from, to, both, protocol, ports}] }]
//   (a connection's from/to is a server name, a segment key like "DB (Sapir)", or "All endpoints")
//
// The picture is airy, like a hand-drawn architecture sketch:
// - A site is a soft, dashed region with its name in the corner (not a box with a header).
// - Inside it, each network segment is a light zone; segments are staggered left/right so lines between
//   them run on a slant instead of straight through each other. Servers are icons with their name under them.
// - A connection is a straight or gently curved line between two servers and/or segments. For each line the
//   bend is chosen so that it does not pass through other servers and does not run along another line;
//   its label sits where it covers no server, line or other label.
// - With "All endpoints" there is no line: the server (or segment) gets a small tag ("↔ ENDPOINTS", then "tcp 139").

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

const C = {
  conn: "#0f766e",
  connTag: "#e3f3f0",
  text: "#1c2733",
  muted: "#5d6b7b",
  siteFill: "#f4f7fb",
  siteLine: "#aebdd1",
  siteText: "#1f3a5f",
  segBody: "#edf3fd",
  segLine: "#9db5e2",
  segText: "#1e3a7a",
  segSubnet: "#2f5bb5",
  dr: "#b45309",
  drBg: "#fdecd3",
};

const G = {
  margin: 36,
  sysW: 150, sysH: 44, sysGap: 36, bandGap: 90, arcBase: 30, arcStep: 22, // several systems (older pictures)
  siteGap: 150, sitePad: 34, siteHead: 62, siteMinW: 280, emptySiteH: 96,
  segPad: 26, segHead: 52, segGap: 56, segStagger: 90, segMinW: 240, segEmpty: 34,
  nodeW: 136, nodeH: 92, nodeGapX: 64, nodeGapY: 64, perRow: 3,
  tagH: 30, tagGap: 4, // an endpoint tag: two short lines
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
const connLabel = (c) => [c.protocol, c.ports].filter(Boolean).join(" ");
const textWidth = (s, px = 11) => s.length * px * 0.6; // rough, good enough to keep things inside the picture

// ---------- small geometry helpers ----------
const inflate = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const contains = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const bezier = (p0, c, p1, t) => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
});
// A point on a curve: { p0, c1, p1 } is quadratic, { p0, c1, c2, p1 } cubic.
function curveAt(cv, t) {
  if (!cv.c2) return bezier(cv.p0, cv.c1, cv.p1, t);
  const u = 1 - t;
  const f = (k) => u * u * u * cv.p0[k] + 3 * u * u * t * cv.c1[k] + 3 * u * t * t * cv.c2[k] + t * t * t * cv.p1[k];
  return { x: f("x"), y: f("y") };
}
// Where the ray from the centre of r towards p leaves r.
function clip(r, centre, p) {
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  if (!dx && !dy) return centre;
  const ts = [];
  if (dx > 0) ts.push((r.x + r.w - centre.x) / dx);
  if (dx < 0) ts.push((r.x - centre.x) / dx);
  if (dy > 0) ts.push((r.y + r.h - centre.y) / dy);
  if (dy < 0) ts.push((r.y - centre.y) / dy);
  const t = Math.min(...ts.filter((v) => v >= 0));
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export const distToPolyline = (p, pts) => {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1], pts[i]));
  return d;
};

// Servers in a grid, at most G.perRow per row. Returns the grid's size; sets rx/ry relative to (0, 0).
function grid(nodes) {
  if (!nodes.length) return { w: 0, h: 0 };
  const cols = Math.min(G.perRow, nodes.length);
  let y = 0;
  for (let i = 0; i < nodes.length; i += cols) {
    const row = nodes.slice(i, i + cols);
    row.forEach((n, j) => { n.rx = j * (G.nodeW + G.nodeGapX); n.ry = y; });
    y += Math.max(...row.map((n) => n.h)) + G.nodeGapY;
  }
  return { w: cols * G.nodeW + (cols - 1) * G.nodeGapX, h: y - G.nodeGapY };
}

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

  // Connections with all endpoints become tags on the server (or segment).
  const key = (system, name) => `${system}\u0000${name}`;
  const tagsOf = new Map();
  models.forEach((m) =>
    (m.connections || []).forEach((c) => {
      const toEndpoints = c.to === ENDPOINTS;
      if (!toEndpoints && c.from !== ENDPOINTS) return;
      const node = toEndpoints ? c.from : c.to;
      if (node === ENDPOINTS) return;
      const k = key(m.system, node);
      if (!tagsOf.has(k)) tagsOf.set(k, []);
      tagsOf.get(k).push({ arrow: c.both ? "↔" : toEndpoints ? "→" : "←", label: connLabel(c), both: !!c.both, out: toEndpoints });
    }),
  );
  const tagsH = (n) => (n.tags.length ? n.tags.length * (G.tagH + G.tagGap) + 2 : 0);

  // Sites with their segments and servers (a site can also exist without them, e.g. a DR site).
  const bySite = new Map();
  const ensureSite = (n) => {
    if (!bySite.has(n)) bySite.set(n, { segments: [], servers: [] });
    return bySite.get(n);
  };
  models.forEach((m) =>
    (m.servers || []).forEach((s) => {
      const tags = tagsOf.get(key(m.system, s.key || s.name)) || tagsOf.get(key(m.system, s.name)) || [];
      ensureSite(s.site).servers.push({
        kind: "server", system: m.system, name: s.name, ref: s.key || s.name, role: s.role || "other", os: s.os || "",
        segment: s.segment || "", tags, h: G.nodeH + tagsH({ tags }),
      });
    }),
  );
  models.forEach((m) =>
    (m.segments || []).forEach((g) => {
      if (!g || !g.name) return;
      ensureSite(g.site).segments.push({
        kind: "segment", system: m.system, name: g.name, ref: g.key || g.name, subnet: g.subnet || "",
        tags: tagsOf.get(key(m.system, g.key || g.name)) || [], members: [],
      });
    }),
  );
  models.forEach((m) => (m.sites || []).forEach(ensureSite));
  const siteNames = [...bySite.keys()].sort((a, b) => a.localeCompare(b));
  const drSites = new Set(models.map((m) => m.dr_site).filter(Boolean));

  // Size everything inside each site (positions relative to the site's corner for now).
  const siteBoxes = siteNames.map((name) => {
    const { segments, servers } = bySite.get(name);
    servers.sort((a, b) => systemByName.get(a.system).index - systemByName.get(b.system).index || a.name.localeCompare(b.name));
    const loose = [];
    servers.forEach((s) => {
      const seg = segments.find((g) => g.system === s.system && g.name === s.segment);
      (seg ? seg.members : loose).push(s);
    });
    const items = []; // segments, and a block of loose servers: { rx, ry, w, h }
    let y = G.siteHead;
    segments.forEach((g, i) => {
      const inner = grid(g.members);
      g.w = Math.max(G.segMinW, inner.w + 2 * G.segPad);
      g.h = G.segHead + tagsH(g) + (g.members.length ? inner.h + G.segPad : G.segEmpty);
      const offset = segments.length > 1 && i % 2 === 1 ? G.segStagger : 0; // zig-zag, so lines run on a slant
      g.rx = G.sitePad + offset;
      g.ry = y;
      const left = (g.w - inner.w) / 2; // servers centred in the zone
      g.members.forEach((s) => { s.rx += g.rx + left; s.ry += g.ry + G.segHead + tagsH(g); });
      items.push(g);
      y += g.h + G.segGap;
    });
    if (loose.length) {
      const inner = grid(loose);
      loose.forEach((s) => { s.rx += G.sitePad; s.ry += y; });
      items.push({ rx: G.sitePad, ry: y, w: inner.w, h: inner.h });
      y += inner.h + G.segGap;
    }
    const empty = !items.length;
    const w = Math.max(G.siteMinW, ...items.map((it) => it.rx + it.w + G.sitePad));
    const h = empty ? G.siteHead + G.emptySiteH : y - G.segGap + G.sitePad;
    return { name, dr: drSites.has(name), empty, w, h, segments, servers };
  });

  // Rows: systems (optional) above the sites.
  const shown = showSystems ? systems : [];
  const sysRowW = shown.length * G.sysW + Math.max(0, shown.length - 1) * G.sysGap;
  const siteRowW = siteBoxes.reduce((t, s) => t + s.w, 0) + Math.max(0, siteBoxes.length - 1) * G.siteGap;
  const contentW = Math.max(sysRowW, siteRowW, showSystems ? G.sysW : G.siteMinW);

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

  // Place the sites, then everything in them.
  const sitesY = showSystems ? sysY + G.sysH + G.bandGap : G.margin;
  const sites = [];
  const segments = [];
  const servers = [];
  let x = G.margin + (contentW - siteRowW) / 2;
  siteBoxes.forEach((b, k) => {
    sites.push({ name: b.name, dr: b.dr, empty: b.empty, x, y: sitesY, w: b.w, h: b.h });
    b.segments.forEach((g) =>
      segments.push({
        kind: "segment", system: g.system, name: g.name, ref: g.ref, subnet: g.subnet, tags: g.tags, count: g.members.length,
        site: b.name, col: k, x: x + g.rx, y: sitesY + g.ry, w: g.w, h: g.h,
      }));
    b.servers.forEach((s) =>
      servers.push({
        kind: "server", system: s.system, name: s.name, ref: s.ref, role: s.role, os: s.os, segment: s.segment, tags: s.tags,
        site: b.name, col: k, x: x + s.rx, y: sitesY + s.ry, w: G.nodeW, h: s.h,
      }));
    x += b.w + G.siteGap;
  });

  // System -> site connectors (several systems in one picture).
  const edges = [];
  if (showSystems) sites.forEach((site) => {
    const owners = [...new Set(servers.filter((s) => s.site === site.name).map((s) => s.system))].sort(
      (a, b) => systemByName.get(a).index - systemByName.get(b).index,
    );
    owners.forEach((name, j) => {
      const sys = systemByName.get(name);
      edges.push({
        system: name, site: site.name,
        x1: sys.x + sys.w / 2, y1: sys.y + sys.h,
        x2: site.x + (site.w * (j + 1)) / (owners.length + 1), y2: site.y,
      });
    });
  });
  const links = rawLinks.map((l) => {
    const h = arcHeight(l.from, l.to, l.from.index > l.to.index);
    const x1 = l.from.x + l.from.w / 2;
    const x2 = l.to.x + l.to.w / 2;
    return { from: l.from.name, to: l.to.name, protocol: l.protocol, x1, x2, y: sysY, h };
  });

  // ---------- connections between servers and/or segments ----------
  const nodeOf = (system, name) =>
    servers.find((s) => s.system === system && s.ref === name) || // "web-1 (Ofek)"
    segments.find((g) => g.system === system && g.ref === name) || // "DB (Sapir)"
    servers.find((s) => s.system === system && s.name === name) || // older pictures: the name alone
    segments.find((g) => g.system === system && g.name === name);
  const header = (g) => ({ x: g.x, y: g.y, w: g.w, h: G.segHead });
  const iconCentre = (s) => ({ x: s.x + s.w / 2, y: s.y + 26 });
  // What a line attaches to: a server's icon-and-name block; a segment's whole zone, or only its header
  // when the other end sits inside that zone.
  const shape = (n, other) => {
    if (n.kind === "server") return { rect: { x: n.x + 8, y: n.y, w: n.w - 16, h: G.nodeH - 6 }, centre: iconCentre(n) };
    const inside = other.kind === "server" && contains(n, iconCentre(other));
    const r = inside ? header(n) : n;
    return { rect: r, centre: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
  };
  const serverRects = servers.map((s) => ({ node: s, rect: { x: s.x + 6, y: s.y, w: s.w - 12, h: s.h } }));
  const placed = []; // sampled points of the lines drawn so far
  const labels = []; // label boxes placed so far
  const connections = [];
  const offsets = [0, 36, -36, 72, -72, 110, -110, 150, -150, 200, -200, 260, -260, 330, -330, 410, -410, 500, -500];

  models.forEach((m) =>
    (m.connections || []).forEach((c) => {
      if (c.from === ENDPOINTS || c.to === ENDPOINTS || c.from === c.to) return;
      const a = nodeOf(m.system, c.from);
      const b = nodeOf(m.system, c.to);
      if (!a || !b) return; // unknown name: in the table only
      const sa = shape(a, b);
      const sb = shape(b, a);
      const own = (g) => [a, b].some((n) => n.kind === "server" && n.segment === g.name && n.site === g.site && n.system === g.system);
      const obstacles = [
        ...serverRects.filter((o) => o.node !== a && o.node !== b).map((o) => ({ rect: inflate(o.rect, 4), cost: 1000 })),
        ...segments.filter((g) => g !== a && g !== b).map((g) => ({ rect: header(g), cost: own(g) ? 40 : 1000 })),
      ];
      const mid = { x: (sa.centre.x + sb.centre.x) / 2, y: (sa.centre.y + sb.centre.y) / 2 };
      const len = Math.hypot(sb.centre.x - sa.centre.x, sb.centre.y - sa.centre.y) || 1;
      const normal = { x: -(sb.centre.y - sa.centre.y) / len, y: (sb.centre.x - sa.centre.x) / len };

      const score = (ctrl, pts, base) => {
        let total = base;
        for (const o of obstacles) if (pts.some((p) => contains(o.rect, p))) total += o.cost;
        // Running along another line (not just crossing it) costs a lot; near their ends lines may meet.
        // Checked both ways round (this line near the other, the other near this one).
        const p0 = pts[0], p1 = pts[pts.length - 1];
        for (const other of placed) {
          const ends = [p0, p1, other[0], other[other.length - 1]];
          const away = (p) => ends.every((e) => Math.hypot(p.x - e.x, p.y - e.y) > 26);
          const near = pts.filter((p) => away(p) && distToPolyline(p, other) < 8).length +
            other.filter((p) => away(p) && distToPolyline(p, pts) < 8).length;
          if (near > 3) total += Math.min(600, 60 * near); // always less than going through a server
        }
        return total;
      };
      let best = null;
      const consider = (curve, base) => {
        const pts = Array.from({ length: 41 }, (_, i) => curveAt(curve, i / 40));
        const total = score(curve, pts, base);
        if (!best || total < best.score) best = { score: total, curve, pts };
      };

      // 1. A straight line, then single bends to either side, a little more each time.
      for (const off of offsets) {
        const ctrl = { x: mid.x + normal.x * off, y: mid.y + normal.y * off };
        const p0 = clip(sa.rect, sa.centre, ctrl);
        const p1 = clip(sb.rect, sb.centre, ctrl);
        const c1 = { x: (p0.x + p1.x) / 2 + normal.x * off, y: (p0.y + p1.y) / 2 + normal.y * off };
        consider({ p0, c1, p1 }, Math.abs(off) / 36);
        if (best.score < 1) break;
      }
      // 2. When that is blocked: a smooth S-curve that swings through a gap between rows (or columns).
      if (best.score >= 1) {
        const ys = new Set();
        const xs = new Set();
        for (const r of [...servers, ...segments, ...sites]) {
          const pad = r.kind === "server" ? G.nodeGapY / 2 : 22;
          ys.add(round(r.y - pad)); ys.add(round(r.y + r.h + pad));
          const padX = r.kind === "server" ? G.nodeGapX / 2 : 22;
          xs.add(round(r.x - padX)); xs.add(round(r.x + r.w + padX));
        }
        const edge = (sh, side) => {
          const r = sh.rect;
          return side === "top" ? { x: sh.centre.x, y: r.y } : side === "bottom" ? { x: sh.centre.x, y: r.y + r.h }
            : side === "left" ? { x: r.x, y: sh.centre.y } : { x: r.x + r.w, y: sh.centre.y };
        };
        for (const y of ys) {
          const p0 = edge(sa, y < sa.centre.y ? "top" : "bottom");
          const p1 = edge(sb, y < sb.centre.y ? "top" : "bottom");
          const k = (8 * y - p0.y - p1.y) / 6; // the curve's middle reaches the gap
          consider({ p0, c1: { x: p0.x, y: k }, c2: { x: p1.x, y: k }, p1 }, 3 + (Math.abs(y - p0.y) + Math.abs(y - p1.y)) / 80);
        }
        for (const x of xs) {
          const p0 = edge(sa, x < sa.centre.x ? "left" : "right");
          const p1 = edge(sb, x < sb.centre.x ? "left" : "right");
          const k = (8 * x - p0.x - p1.x) / 6;
          consider({ p0, c1: { x: k, y: p0.y }, c2: { x: k, y: p1.y }, p1 }, 3 + (Math.abs(x - p0.x) + Math.abs(x - p1.x)) / 80);
        }
      }
      placed.push(best.pts);

      // The label: on the line, where it covers no server, segment header, other line or label.
      const label = connLabel(c);
      const lw = textWidth(label) + 10;
      let spot = null;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
        const p = curveAt(best.curve, t);
        const box = { x: p.x - lw / 2, y: p.y - 9, w: lw, h: 17 };
        let score = Math.abs(t - 0.5) * 10;
        for (const o of serverRects) if (overlaps(box, o.rect)) score += 100;
        for (const g of segments) if (overlaps(box, header(g))) score += 100;
        for (const l of labels) if (overlaps(box, inflate(l, 3))) score += 100;
        for (const other of placed.slice(0, -1)) score += 4 * other.filter((q) => contains(box, q)).length;
        if (!spot || score < spot.score) spot = { score, p, box };
        if (score < 0.5) break;
      }
      if (label) labels.push(spot.box);
      connections.push({
        system: m.system, from: c.from, to: c.to, both: !!c.both,
        protocol: c.protocol || "", ports: c.ports || "", label,
        curve: best.curve, points: best.pts,
        labelX: spot.p.x, labelY: spot.p.y + 4, labelBox: label ? spot.box : null, labelAnchor: "middle",
      });
    }),
  );

  // Size of the picture: everything with a margin; shift right/down if a curve or label went past the edge.
  const boxes = [
    ...sites, ...shown,
    ...links.map((l) => ({ x: Math.min(l.x1, l.x2), y: l.y - l.h - 18, w: Math.abs(l.x2 - l.x1), h: 0 })),
    ...connections.flatMap((c) => c.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))),
    ...labels,
  ];
  const dx = G.margin - Math.min(G.margin, ...boxes.map((b) => b.x));
  const dy = G.margin - Math.min(G.margin, ...boxes.map((b) => b.y));
  const width = Math.max(contentW + G.margin, ...boxes.map((b) => b.x + b.w)) + dx + G.margin;
  const height = Math.max(sitesY + G.emptySiteH, ...boxes.map((b) => b.y + b.h)) + dy + G.margin;
  const move = (o) => { o.x += dx; o.y += dy; };
  [...sites, ...segments, ...servers, ...shown].forEach(move);
  edges.forEach((e) => { e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; });
  const linkOut = links.map((l) => {
    const x1 = l.x1 + dx, x2 = l.x2 + dx, y = l.y + dy;
    return {
      from: l.from, to: l.to, protocol: l.protocol,
      d: `M ${round(x1)} ${round(y)} Q ${round((x1 + x2) / 2)} ${round(y - 2 * l.h)} ${round(x2)} ${round(y)}`,
      labelX: round((x1 + x2) / 2), labelY: round(y - l.h - 5),
    };
  });
  for (const c of connections) {
    const cv = c.curve;
    [cv.p0, cv.c1, cv.c2, cv.p1, ...c.points].filter(Boolean).forEach(move);
    if (c.labelBox) move(c.labelBox);
    const pt = (p) => `${round(p.x)} ${round(p.y)}`;
    c.d = cv.c2 ? `M ${pt(cv.p0)} C ${pt(cv.c1)} ${pt(cv.c2)} ${pt(cv.p1)}` : `M ${pt(cv.p0)} Q ${pt(cv.c1)} ${pt(cv.p1)}`;
    c.labelX = round(c.labelX + dx);
    c.labelY = round(c.labelY + dy);
  }

  return { width: round(width), height: round(height), systems: shown, sites, segments, servers, edges, links: linkOut, connections };
}

// A small picture per role: a database is a cylinder, a web server a tower with a globe, others a tower.
function serverIcon(cx, top, role) {
  const col = roleColor(role);
  if (role === "database") {
    const w = 36, h = 42, x = cx - w / 2, ry = 6;
    return `<path d="M ${x} ${top + ry} V ${top + h - ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${top + h - ry} V ${top + ry}" fill="${col}"/>` +
      `<ellipse cx="${cx}" cy="${top + ry}" rx="${w / 2}" ry="${ry}" fill="${col}" stroke="#ffffff" stroke-width="1.5"/>` +
      `<path d="M ${x} ${top + 18} A ${w / 2} ${ry} 0 0 0 ${x + w} ${top + 18} M ${x} ${top + 29} A ${w / 2} ${ry} 0 0 0 ${x + w} ${top + 29}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.5"/>`;
  }
  const w = 32, h = 44, x = cx - w / 2;
  let out = `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="5" fill="${col}"/>` +
    `<rect x="${x + 7}" y="${top + 8}" width="${w - 14}" height="3.5" rx="1.5" fill="#ffffff" opacity="0.85"/>` +
    `<rect x="${x + 7}" y="${top + 15}" width="${w - 14}" height="3.5" rx="1.5" fill="#ffffff" opacity="0.85"/>` +
    `<circle cx="${cx}" cy="${top + h - 9}" r="2.6" fill="#ffffff" opacity="0.9"/>`;
  if (role === "web") {
    const gx = x + w, gy = top + h - 6;
    out += `<circle cx="${gx}" cy="${gy}" r="9" fill="#ffffff"/><circle cx="${gx}" cy="${gy}" r="7.5" fill="none" stroke="${col}" stroke-width="1.5"/>` +
      `<ellipse cx="${gx}" cy="${gy}" rx="3.2" ry="7.5" fill="none" stroke="${col}" stroke-width="1.2"/>` +
      `<path d="M ${gx - 7.5} ${gy} H ${gx + 7.5}" stroke="${col}" stroke-width="1.2"/>`;
  }
  return out;
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
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${C.conn}"/></marker></defs>`,
  );
  if (options.background !== false) out.push(`<rect width="${L.width}" height="${L.height}" fill="#ffffff"/>`);

  // Sites: a soft dashed region, its name in the corner.
  for (const s of L.sites) {
    out.push(
      `<g><title>${escapeXml(`Site: ${s.name}${s.dr ? " (DR site)" : ""}`)}</title>` +
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="28" fill="${C.siteFill}" fill-opacity="0.75" stroke="${C.siteLine}" stroke-width="1.5" stroke-dasharray="9 7"/>` +
        `<text x="${s.x + 26}" y="${s.y + 26}" font-size="10" font-weight="700" letter-spacing="1.5" fill="#8a9bb2">SITE</text>` +
        `<text x="${s.x + 26}" y="${s.y + 47}" font-size="20" font-weight="700" fill="${C.siteText}">${escapeXml(truncate(s.name, Math.floor((s.w - 90) / 11)))}</text>` +
        (s.dr
          ? `<rect x="${s.x + s.w - 62}" y="${s.y + 30}" width="38" height="20" rx="10" fill="${C.drBg}"/>` +
            `<text x="${s.x + s.w - 43}" y="${s.y + 44}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.dr}">DR</text>`
          : "") +
        (s.empty ? `<text x="${s.x + s.w / 2}" y="${s.y + G.siteHead + 44}" text-anchor="middle" fill="#7a8594" font-style="italic">nothing described yet</text>` : "") +
        `</g>`,
    );
  }

  // Endpoint tags under a server's name, or under a segment's header.
  const tagPills = (n, top, x, w) => n.tags.map((t, i) => {
    const y = top + i * (G.tagH + G.tagGap);
    return `<g><title>${escapeXml(`${t.both ? "Both ways with" : t.out ? "To" : "From"} all endpoints${t.label ? ": " + t.label : ""}`)}</title>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${G.tagH}" rx="9" fill="${C.connTag}"/>` +
      `<text x="${x + w / 2}" y="${y + 12}" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="0.8" fill="${C.conn}">${t.arrow} ENDPOINTS</text>` +
      (t.label ? `<text x="${x + w / 2}" y="${y + 25}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.conn}">${escapeXml(truncate(t.label, Math.floor((w - 12) / 6.3)))}</text>` : "") +
      `</g>`;
  }).join("");

  // Network segments: a light zone with its name and subnet.
  for (const g of L.segments) {
    const pillW = g.subnet ? textWidth(g.subnet, 11) + 16 : 0;
    const tagsBlock = g.tags.length ? g.tags.length * (G.tagH + G.tagGap) + 2 : 0;
    out.push(
      `<g><title>${escapeXml(`Segment: ${g.name}${g.subnet ? " (" + g.subnet + ")" : ""} – ${g.count} ${g.count === 1 ? "server" : "servers"}`)}</title>` +
        `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="18" fill="${C.segBody}" stroke="${C.segLine}" stroke-width="1.3"/>` +
        `<text x="${g.x + 18}" y="${g.y + 21}" font-size="9" font-weight="700" letter-spacing="1.1" fill="${C.segSubnet}">SEGMENT</text>` +
        `<text x="${g.x + 18}" y="${g.y + 38}" font-size="14" font-weight="700" fill="${C.segText}">${escapeXml(truncate(g.name, Math.max(6, Math.floor((g.w - 40 - pillW) / 8.2))))}</text>` +
        (g.subnet
          ? `<rect x="${g.x + g.w - 14 - pillW}" y="${g.y + 17}" width="${pillW}" height="20" rx="10" fill="#ffffff" stroke="${C.segLine}"/>` +
            `<text x="${g.x + g.w - 14 - pillW / 2}" y="${g.y + 31}" text-anchor="middle" font-size="11" font-weight="600" font-family="ui-monospace, Menlo, Consolas, monospace" fill="${C.segSubnet}">${escapeXml(g.subnet)}</text>`
          : "") +
        (g.count ? "" : `<text x="${g.x + g.w / 2}" y="${g.y + G.segHead + tagsBlock + 20}" text-anchor="middle" font-size="11.5" fill="#7a8594" font-style="italic">no servers in this segment</text>`) +
        `</g>` + tagPills(g, g.y + G.segHead, g.x + 18, g.w - 36),
    );
  }

  for (const e of L.edges) {
    out.push(
      `<g><title>${escapeXml(`${e.system} has servers in ${e.site}`)}</title>` +
        `<line x1="${round(e.x1)}" y1="${round(e.y1)}" x2="${round(e.x2)}" y2="${round(e.y2)}" stroke="#9aa6b5" stroke-dasharray="4 4"/>` +
        `<circle cx="${round(e.x2)}" cy="${round(e.y2)}" r="3.5" fill="#9aa6b5"/></g>`,
    );
  }

  for (const c of L.connections) {
    out.push(
      `<g><title>${escapeXml(`${c.from} ${c.both ? "↔" : "→"} ${c.to}${c.label ? ": " + c.label : ""}`)}</title>` +
        `<path d="${c.d}" fill="none" stroke="${C.conn}" stroke-width="1.7" stroke-linecap="round" marker-end="url(#arrow-conn)"${c.both ? ' marker-start="url(#arrow-conn)"' : ""}/></g>`,
    );
  }

  // Servers: an icon, the name under it, then role and OS.
  for (const s of L.servers) {
    const cx = s.x + s.w / 2;
    const detail = [s.role, s.os].filter(Boolean).join(" · ");
    const sub = L.systems.length ? `${s.system}${detail ? " · " + detail : ""}` : detail;
    out.push(
      `<g><title>${escapeXml(`${s.name}${L.systems.length ? ` (${s.system})` : ""}${detail ? " – " + detail : ""}`)}</title>` +
        serverIcon(cx, s.y + 4, s.role) +
        `<text x="${cx}" y="${s.y + 66}" text-anchor="middle" font-weight="600" fill="${C.text}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(s.name, 18))}</text>` +
        `<text x="${cx}" y="${s.y + 81}" text-anchor="middle" font-size="11" fill="${C.muted}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(sub, 22))}</text>` +
        `</g>` + tagPills(s, s.y + G.nodeH - 2, s.x + 4, s.w - 8),
    );
  }

  // Connection labels last, so nothing covers them.
  for (const c of L.connections) {
    if (!c.label) continue;
    out.push(
      `<text x="${c.labelX}" y="${c.labelY}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.conn}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(c.label, 30))}</text>`,
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
