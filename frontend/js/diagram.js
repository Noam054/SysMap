// Draws the architecture as SVG, with no libraries (works fully offline).
// Input: the normalized models from GET /api/model:
//   [{ system, sites: [..], dr_site, segments: [{name, site, subnet, key}], servers: [{name, site, role, os, segment, key, off}],
//      links: [{to, protocol}], connections: [{from, to, both, protocol, ports}], skipping: [{action, server, note}] }]
//   (a connection's from/to is a server name, a segment key like "DB (Sapir)", or "All endpoints")
//
// The picture is airy, like a hand-drawn architecture sketch:
// - A site is a soft, dashed region with its name in the corner (not a box with a header).
// - Inside it, each network segment is a light zone; segments are staggered left/right so lines between
//   them run on a slant instead of straight through each other. Servers are icons with their name under them.
// - A connection is a straight or gently curved line between two servers and/or segments. For each line the
//   bend is chosen so that it does not pass through other servers and does not run along another line;
//   its label sits where it covers no server, line or other label.
// - "All endpoints" are the same workstations for every segment and site: one wide zone across the bottom of
//   the picture, with PCs in it. A connection with all endpoints is a line down to that zone.

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
  endFill: "#eef7f5",
  endLine: "#8fcabf",
  endText: "#0b4f49",
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
  endGap: 130, endH: 136, endPad: 44, pcStep: 60, endOver: 200, zoneStep: 34, // the "All endpoints" zone at the bottom
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


  // What has a connection with all endpoints: drawn at the bottom of its site, nearest the endpoints zone.
  const touchesZone = new Set();
  models.forEach((m) => (m.connections || []).forEach((c) => {
    if (c.from === ENDPOINTS && c.to !== ENDPOINTS) touchesZone.add(`${m.system}\u0000${c.to}`);
    if (c.to === ENDPOINTS && c.from !== ENDPOINTS) touchesZone.add(`${m.system}\u0000${c.from}`);
  }));
  const touches = (n) => touchesZone.has(`${n.system}\u0000${n.ref}`) || touchesZone.has(`${n.system}\u0000${n.name}`);

  // Sites with their segments and servers (a site can also exist without them, e.g. a DR site).
  const bySite = new Map();
  const ensureSite = (n) => {
    if (!bySite.has(n)) bySite.set(n, { segments: [], servers: [] });
    return bySite.get(n);
  };
  models.forEach((m) =>
    (m.servers || []).forEach((s) => {
      ensureSite(s.site).servers.push({
        kind: "server", system: m.system, name: s.name, ref: s.key || s.name, role: s.role || "other", os: s.os || "",
        segment: s.segment || "", h: G.nodeH, off: !!s.off,
      });
    }),
  );
  models.forEach((m) =>
    (m.segments || []).forEach((g) => {
      if (!g || !g.name) return;
      ensureSite(g.site).segments.push({
        kind: "segment", system: m.system, name: g.name, ref: g.key || g.name, subnet: g.subnet || "",
        members: [],
      });
    }),
  );
  models.forEach((m) => (m.sites || []).forEach(ensureSite));
  const siteNames = [...bySite.keys()].sort((a, b) => a.localeCompare(b));
  const drSites = new Set(models.map((m) => m.dr_site).filter(Boolean));

  // Size everything inside each site (positions relative to the site's corner for now).
  const siteBoxes = siteNames.map((name) => {
    const { segments, servers } = bySite.get(name);
    // Servers that talk to the endpoints come last, so they sit in the bottom row (nearest the zone).
    servers.sort((a, b) => touches(a) - touches(b) ||
      systemByName.get(a.system).index - systemByName.get(b.system).index || a.name.localeCompare(b.name));
    const loose = [];
    servers.forEach((s) => {
      const seg = segments.find((g) => g.system === s.system && g.name === s.segment);
      (seg ? seg.members : loose).push(s);
    });
    // Segments too: one that talks to the endpoints goes to the bottom of its site; one that holds such a
    // server comes just above it. The rest keep their order.
    const rank = (g) => (touches(g) ? 2 : g.members.some(touches) ? 1 : 0);
    segments.sort((a, b) => rank(a) - rank(b));
    const items = []; // segments, and a block of loose servers: { rx, ry, w, h }
    let y = G.siteHead;
    segments.forEach((g, i) => {
      const inner = grid(g.members);
      g.w = Math.max(G.segMinW, inner.w + 2 * G.segPad);
      g.h = G.segHead + (g.members.length ? inner.h + G.segPad : G.segEmpty);
      const offset = segments.length > 1 && i % 2 === 1 ? G.segStagger : 0; // zig-zag, so lines run on a slant
      g.rx = G.sitePad + offset;
      g.ry = y;
      const left = (g.w - inner.w) / 2; // servers centred in the zone
      g.members.forEach((s) => { s.rx += g.rx + left; s.ry += g.ry + G.segHead; });
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
        kind: "segment", system: g.system, name: g.name, ref: g.ref, subnet: g.subnet, count: g.members.length,
        site: b.name, col: k, x: x + g.rx, y: sitesY + g.ry, w: g.w, h: g.h,
      }));
    b.servers.forEach((s) =>
      servers.push({
        kind: "server", system: s.system, name: s.name, ref: s.ref, role: s.role, os: s.os, segment: s.segment,
        off: s.off, site: b.name, col: k, x: x + s.rx, y: sitesY + s.ry, w: G.nodeW, h: s.h,
      }));
    x += b.w + G.siteGap;
  });

  // "All endpoints": one zone as wide as all the sites, under them, when any connection uses it.
  let endpoints = null;
  if (models.some((m) => (m.connections || []).some((c) => c.from === ENDPOINTS || c.to === ENDPOINTS))) {
    const left = sites.length ? Math.min(...sites.map((s) => s.x)) : G.margin;
    const right = sites.length ? Math.max(...sites.map((s) => s.x + s.w)) : G.margin + contentW;
    const bottom = sites.length ? Math.max(...sites.map((s) => s.y + s.h)) : sitesY;
    // Wider than the sites on both sides, so it reads as one band under the whole picture.
    const w = Math.max(right - left, G.siteMinW) + 2 * G.endOver;
    endpoints = {
      kind: "endpoints", name: ENDPOINTS, ref: ENDPOINTS, x: left - G.endOver, y: bottom + G.endGap, w, h: G.endH,
      pcs: Math.max(3, Math.min(40, Math.floor((w - 2 * G.endPad) / G.pcStep))),
    };
  }

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
    (name === ENDPOINTS ? endpoints : null) ||
    servers.find((s) => s.system === system && s.ref === name) || // "web-1 (Ofek)"
    segments.find((g) => g.system === system && g.ref === name) || // "DB (Sapir)"
    servers.find((s) => s.system === system && s.name === name) || // older pictures: the name alone
    segments.find((g) => g.system === system && g.name === name);
  const header = (g) => ({ x: g.x, y: g.y, w: g.w, h: G.segHead });
  const iconCentre = (s) => ({ x: s.x + s.w / 2, y: s.y + 26 });
  // What a line attaches to: a server's icon-and-name block; a segment's whole zone, or only its header
  // when the other end sits inside that zone.
  const centreOf = (n) => (n.kind === "server" ? iconCentre(n) : { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const shape = (n, other) => {
    // The endpoints zone: the line comes straight down to it, under the other end.
    if (n.kind === "endpoints") {
      const x = zoneAt ?? Math.max(n.x + 30, Math.min(n.x + n.w - 30, centreOf(other).x));
      return { rect: { x: n.x + 24, y: n.y, w: n.w - 48, h: 2 }, centre: { x, y: n.y + 1 } }; // always on its top edge
    }
    if (n.kind === "server") return { rect: { x: n.x + 8, y: n.y, w: n.w - 16, h: G.nodeH - 6 }, centre: iconCentre(n) };
    const inside = other.kind === "server" && contains(n, iconCentre(other));
    const r = inside ? header(n) : n;
    return { rect: r, centre: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
  };
  const serverRects = servers.map((s) => ({ node: s, rect: { x: s.x + 6, y: s.y, w: s.w - 12, h: s.h } }));

  // Lines to the endpoints zone enter it side by side, a short step apart, around the middle of where they
  // come from (in the order they come from, so they do not cross on the way down).
  const zoneX = new Map(); // connection -> x where it enters the zone
  if (endpoints) {
    const list = [];
    models.forEach((m) => (m.connections || []).forEach((c) => {
      const other = c.to === ENDPOINTS ? c.from : c.from === ENDPOINTS ? c.to : null;
      const n = other && other !== ENDPOINTS ? nodeOf(m.system, other) : null;
      if (n) list.push({ c, x: centreOf(n).x });
    }));
    list.sort((p, q) => p.x - q.x);
    const span = G.zoneStep * Math.max(0, list.length - 1);
    const mid = list.reduce((t, p) => t + p.x, 0) / (list.length || 1);
    const lo = endpoints.x + 60;
    const hi = endpoints.x + endpoints.w - 60;
    const start = Math.max(lo, Math.min(hi - span, mid - span / 2));
    list.forEach((p, i) => zoneX.set(p.c, start + i * G.zoneStep));
  }
  let zoneAt = null; // where the connection being drawn enters the zone
  const placed = []; // sampled points of the lines drawn so far
  const labels = []; // label boxes placed so far
  const connections = [];
  const offsets = [0, 36, -36, 72, -72, 110, -110, 150, -150, 200, -200, 260, -260, 330, -330, 410, -410, 500, -500];

  models.forEach((m) =>
    (m.connections || []).forEach((c, index) => {
      if (c.from === c.to) return;
      const a = nodeOf(m.system, c.from);
      const b = nodeOf(m.system, c.to);
      if (!a || !b) return; // unknown name: in the table only
      zoneAt = zoneX.get(c) ?? null;
      const sa = shape(a, b);
      const sb = shape(b, a);
      const own = (g) => [a, b].some((n) => n.kind === "server" && n.segment === g.name && n.site === g.site && n.system === g.system);
      const obstacles = [
        ...serverRects.filter((o) => o.node !== a && o.node !== b).map((o) => ({ rect: inflate(o.rect, 4), cost: 1000 })),
        ...segments.filter((g) => g !== a && g !== b).map((g) => ({ rect: header(g), cost: own(g) ? 40 : 1000 })),
        ...(endpoints && a !== endpoints && b !== endpoints ? [{ rect: endpoints, cost: 1000 }] : []),
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
        for (const r of [...servers, ...segments, ...sites, ...(endpoints ? [endpoints] : [])]) {
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
      // A line to or from all endpoints: its label is a pill near the zone that says so ("HTTPS 443 → endpoints").
      const zone = b === endpoints ? (c.both ? "↔" : "→") : a === endpoints ? (c.both ? "↔" : "←") : null;
      const label = zone ? `${connLabel(c) ? connLabel(c) + " " : ""}${zone} endpoints` : connLabel(c);
      const lw = zone ? textWidth(label, 11.5) + 22 : textWidth(label) + 10;
      const lh = zone ? 22 : 17;
      const ts = !zone ? [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]
        : b === endpoints ? [0.8, 0.74, 0.86, 0.68, 0.6, 0.52] : [0.2, 0.26, 0.14, 0.32, 0.4, 0.48];
      let spot = null;
      for (const t of ts) {
        const p = curveAt(best.curve, t);
        const box = { x: p.x - lw / 2, y: p.y - lh / 2 - 1, w: lw, h: lh };
        let score = Math.abs(t - ts[0]) * 10;
        for (const o of serverRects) if (overlaps(box, o.rect)) score += 100;
        for (const g of segments) if (overlaps(box, header(g))) score += 100;
        for (const l of labels) if (overlaps(box, inflate(l, 3))) score += 100;
        for (const other of placed.slice(0, -1)) score += 4 * other.filter((q) => contains(box, q)).length;
        if (!spot || score < spot.score) spot = { score, p, box };
        if (score < 0.5) break;
      }
      if (label) labels.push(spot.box);
      connections.push({
        system: m.system, index, from: c.from, to: c.to, both: !!c.both,
        protocol: c.protocol || "", ports: c.ports || "", label,
        curve: best.curve, points: best.pts,
        labelX: spot.p.x, labelY: spot.p.y + 4, labelBox: label ? spot.box : null, labelAnchor: "middle",
        zone: !!zone,
      });
    }),
  );

  // Size of the picture: everything with a margin; shift right/down if a curve or label went past the edge.
  const boxes = [
    ...sites, ...shown, ...(endpoints ? [endpoints] : []),
    ...links.map((l) => ({ x: Math.min(l.x1, l.x2), y: l.y - l.h - 18, w: Math.abs(l.x2 - l.x1), h: 0 })),
    ...connections.flatMap((c) => c.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))),
    ...labels,
  ];
  const dx = G.margin - Math.min(G.margin, ...boxes.map((b) => b.x));
  const dy = G.margin - Math.min(G.margin, ...boxes.map((b) => b.y));
  const width = Math.max(contentW + G.margin, ...boxes.map((b) => b.x + b.w)) + dx + G.margin;
  const height = Math.max(sitesY + G.emptySiteH, ...boxes.map((b) => b.y + b.h)) + dy + G.margin;
  const move = (o) => { o.x += dx; o.y += dy; };
  [...sites, ...segments, ...servers, ...shown, ...(endpoints ? [endpoints] : [])].forEach(move);
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

  // The endpoints zone reaches the picture's left, right and bottom edges: the ground under every site.
  if (endpoints) {
    endpoints.x = 0;
    endpoints.w = round(width);
    endpoints.h = round(height) - endpoints.y;
    endpoints.pcs = Math.max(3, Math.min(40, Math.floor((endpoints.w - 2 * G.endPad) / G.pcStep)));
  }

  return { width: round(width), height: round(height), systems: shown, sites, segments, servers, endpoints, edges, links: linkOut, connections };
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

// ---------- what is in use: turned-off servers, and the communication they leave unused ----------
// Every connection the team entered is always open. A server that is turned off (on standby, or by a skipping
// step) is drawn grey, and so is what it leaves unused:
// - a segment is idle when it has servers and all of them are off (a segment with no servers stays in use);
// - a connection is idle when one of its ends is an off server or an idle segment ("All endpoints" is always
//   in use). It is drawn grey, never removed.
// off: the keys of the servers that are off (default: those on standby in the answers).
export function activeState(model, off) {
  const servers = model.servers || [];
  const offServers = new Set(off ?? servers.filter((s) => s.off).map((s) => s.key));
  const idleSegments = new Set();
  for (const g of model.segments || []) {
    const members = servers.filter((s) => s.site === g.site && s.segment === g.name);
    if (members.length && members.every((s) => offServers.has(s.key))) idleSegments.add(g.key);
  }
  const used = (end) => end === ENDPOINTS || !(offServers.has(end) || idleSegments.has(end));
  const idleConnections = new Set();
  (model.connections || []).forEach((c, i) => { if (!used(c.from) || !used(c.to)) idleConnections.add(i); });
  return { offServers, idleSegments, idleConnections };
}

const connText = (c) => `${c.from} ${c.both ? "↔" : "→"} ${c.to}`;
const listText = (items, most = 3) =>
  items.slice(0, most).join(", ") + (items.length > most ? ` and ${items.length - most} more` : "");

// The skipping process, frame by frame: the start, then one frame per step. Each frame has the state after it
// (see activeState), what the step changed, and a caption.
export function skippingFrames(model) {
  const steps = model.skipping || [];
  const conns = model.connections || [];
  let state = activeState(model);
  const off = state.offServers;
  const frames = [{
    step: 0, ...state, server: null, stopped: [], started: [],
    caption: off.size
      ? `Before skipping: ${listText([...off])} ${off.size === 1 ? "is" : "are"} turned off, so the grey communication is open but not in use.`
      : "Before skipping: every server is on.",
  }];
  steps.forEach((step, i) => {
    const next = new Set(state.offServers);
    if (step.action === "on") next.delete(step.server); else next.add(step.server);
    const after = activeState(model, next);
    const stopped = [...after.idleConnections].filter((c) => !state.idleConnections.has(c));
    const started = [...state.idleConnections].filter((c) => !after.idleConnections.has(c));
    const what = `${step.action === "on" ? "Turn on" : "Turn off"} ${step.server}`;
    const effect = [
      stopped.length ? `Stops: ${listText(stopped.map((c) => connText(conns[c])))}.` : "",
      started.length ? `Starts: ${listText(started.map((c) => connText(conns[c])))}.` : "",
    ].filter(Boolean).join(" ");
    frames.push({
      step: i + 1, ...after, server: step.server, action: step.action, stopped, started,
      caption: `Step ${i + 1} of ${steps.length}: ${what}.${step.note ? " " + step.note.replace(/\.?$/, ".") : ""}${effect ? " " + effect : ""}`,
    });
    state = after;
  });
  return frames;
}

// Grey for what is turned off or not in use. Inside the SVG, so a downloaded file looks the same; the
// skipping animation (app.js) only switches these classes.
const STATE_STYLE = `<style>
.srv .body, .seg, .conn path, .conn-label { transition: opacity .4s, filter .4s, stroke .4s; }
.srv .off-tag { opacity: 0; transition: opacity .4s; }
.srv.off .body { opacity: .32; filter: grayscale(1); }
.srv.off .off-tag { opacity: 1; }
.seg.idle { opacity: .55; filter: grayscale(1); }
.conn.idle path { stroke: #a9b3bf; stroke-dasharray: 7 6; stroke-width: 1.7; }
.conn.idle path[marker-end] { marker-end: url(#arrow-idle); }
.conn.idle path[marker-start] { marker-start: url(#arrow-idle); }
.conn-label.idle { opacity: .5; filter: grayscale(1); }
.srv.pulse .body { animation: srv-pulse .55s ease-in-out 2; transform-box: fill-box; transform-origin: center; }
@keyframes srv-pulse { 50% { transform: scale(1.18); } }
</style>`;

// A desktop PC: a monitor on a stand, centred at cx, its top at top (about 30 high).
function pcIcon(cx, top) {
  return `<rect x="${round(cx - 16)}" y="${top}" width="32" height="22" rx="3" fill="#4f6478"/>` +
    `<rect x="${round(cx - 13)}" y="${top + 3}" width="26" height="15" rx="1.5" fill="#d7e6f2"/>` +
    `<rect x="${round(cx - 2.5)}" y="${top + 22}" width="5" height="5" fill="#4f6478"/>` +
    `<rect x="${round(cx - 9)}" y="${top + 27}" width="18" height="3" rx="1.5" fill="#4f6478"/>`;
}

// Turns the layout into an SVG string. Colours are inline so the exported file looks the same everywhere.
// options: { showSystems } (see layout) and { background: false } for a see-through picture (the app
// draws a dotted canvas behind it). Downloaded files keep the default white background.
export function renderSvg(models, options = {}) {
  if (!models || !models.length) return null;
  const L = layout(models, options);
  const states = new Map(models.map((m) => [m.system, activeState(m)]));
  const stateOf = (system) => states.get(system) || activeState({});
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-size="13" role="img" aria-label="Systems architecture diagram">`,
  );
  out.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="#3b4a5e"/></marker>` +
      `<marker id="arrow-conn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${C.conn}"/></marker>` +
      `<marker id="arrow-zone" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${C.conn}"/></marker>` +
      `<marker id="arrow-idle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="#a9b3bf"/></marker></defs>`,
  );
  out.push(STATE_STYLE);
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

  // All endpoints: a wide zone across the bottom with a row of PCs, the same for every site and segment.
  if (L.endpoints) {
    const e = L.endpoints;
    const step = (e.w - 2 * G.endPad) / e.pcs;
    // Two rows of PCs, and the word "Endpoints" under them.
    const pcs = Array.from({ length: e.pcs }, (_, i) => pcIcon(e.x + G.endPad + step * (i + 0.5), e.y + 34)).join("") +
      Array.from({ length: e.pcs - 1 }, (_, i) => pcIcon(e.x + G.endPad + step * (i + 1), e.y + 88)).join("");
    out.push(
      `<g><title>All endpoints: the workstations of every site</title>` +
        `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${C.endFill}"/>` +
        `<line x1="${e.x}" y1="${e.y}" x2="${e.x + e.w}" y2="${e.y}" stroke="${C.endLine}" stroke-width="1.6"/>` +
        `<text x="${round(e.x + e.w / 2)}" y="${e.y + e.h - 20}" text-anchor="middle" font-size="16" font-weight="700" fill="${C.endText}">Endpoints</text>` +
        pcs + `</g>`,
    );
  }

  // Network segments: a light zone with its name and subnet.
  for (const g of L.segments) {
    const pillW = g.subnet ? textWidth(g.subnet, 11) + 16 : 0;
    const idle = stateOf(g.system).idleSegments.has(g.ref);
    out.push(
      `<g class="seg${idle ? " idle" : ""}" data-seg="${escapeXml(g.ref)}"><title>${escapeXml(`Segment: ${g.name}${g.subnet ? " (" + g.subnet + ")" : ""} – ${g.count} ${g.count === 1 ? "server" : "servers"}`)}</title>` +
        `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="18" fill="${C.segBody}" stroke="${C.segLine}" stroke-width="1.3"/>` +
        `<text x="${g.x + 18}" y="${g.y + 21}" font-size="9" font-weight="700" letter-spacing="1.1" fill="${C.segSubnet}">SEGMENT</text>` +
        `<text x="${g.x + 18}" y="${g.y + 38}" font-size="14" font-weight="700" fill="${C.segText}">${escapeXml(truncate(g.name, Math.max(6, Math.floor((g.w - 40 - pillW) / 8.2))))}</text>` +
        (g.subnet
          ? `<rect x="${g.x + g.w - 14 - pillW}" y="${g.y + 17}" width="${pillW}" height="20" rx="10" fill="#ffffff" stroke="${C.segLine}"/>` +
            `<text x="${g.x + g.w - 14 - pillW / 2}" y="${g.y + 31}" text-anchor="middle" font-size="11" font-weight="600" font-family="ui-monospace, Menlo, Consolas, monospace" fill="${C.segSubnet}">${escapeXml(g.subnet)}</text>`
          : "") +
        (g.count ? "" : `<text x="${g.x + g.w / 2}" y="${g.y + G.segHead + 20}" text-anchor="middle" font-size="11.5" fill="#7a8594" font-style="italic">no servers in this segment</text>`) +
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

  const connAttrs = (c, cls) =>
    `class="${cls}${stateOf(c.system).idleConnections.has(c.index) ? " idle" : ""}" data-conn="${c.index}"`;
  for (const c of L.connections) {
    out.push(
      `<g ${connAttrs(c, "conn")}><title>${escapeXml(`${c.from} ${c.both ? "↔" : "→"} ${c.to}${c.label ? ": " + c.label : ""}`)}</title>` +
        (c.zone
          ? `<path d="${c.d}" fill="none" stroke="${C.conn}" stroke-width="3.4" stroke-linecap="round" marker-end="url(#arrow-zone)"${c.both ? ' marker-start="url(#arrow-zone)"' : ""}/>`
          : `<path d="${c.d}" fill="none" stroke="${C.conn}" stroke-width="2.4" stroke-linecap="round" marker-end="url(#arrow-conn)"${c.both ? ' marker-start="url(#arrow-conn)"' : ""}/>`) +
        `</g>`,
    );
  }

  // Servers: an icon, the name under it, then role and OS.
  for (const s of L.servers) {
    const cx = s.x + s.w / 2;
    const detail = [s.role, s.os].filter(Boolean).join(" · ");
    const sub = L.systems.length ? `${s.system}${detail ? " · " + detail : ""}` : detail;
    const off = stateOf(s.system).offServers.has(s.ref);
    out.push(
      `<g class="srv${off ? " off" : ""}" data-key="${escapeXml(s.ref)}"><title>${escapeXml(`${s.name}${L.systems.length ? ` (${s.system})` : ""}${detail ? " – " + detail : ""}`)}</title><g class="body">` +
        serverIcon(cx, s.y + 4, s.role) +
        `<text x="${cx}" y="${s.y + 66}" text-anchor="middle" font-weight="600" fill="${C.text}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(s.name, 18))}</text>` +
        `<text x="${cx}" y="${s.y + 81}" text-anchor="middle" font-size="11" fill="${C.muted}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(sub, 22))}</text>` +
        `</g><g class="off-tag"><rect x="${cx + 14}" y="${s.y}" width="32" height="17" rx="8.5" fill="#5d6b7b"/>` +
        `<text x="${cx + 30}" y="${s.y + 12.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#ffffff">OFF</text></g>` +
        `</g>`,
    );
  }

  // Connection labels last, so nothing covers them.
  for (const c of L.connections) {
    if (!c.label) continue;
    if (c.zone) { // a pill, like the zone itself
      const b = c.labelBox;
      out.push(
        `<g ${connAttrs(c, "conn-label")}><rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${b.h}" rx="${b.h / 2}" fill="${C.endFill}" stroke="${C.conn}" stroke-width="1.2"/>` +
        `<text x="${c.labelX}" y="${round(b.y + b.h / 2 + 4)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${C.endText}">${escapeXml(c.label)}</text></g>`,
      );
      continue;
    }
    out.push(
      `<g ${connAttrs(c, "conn-label")}><text x="${c.labelX}" y="${c.labelY}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.conn}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${escapeXml(truncate(c.label, 30))}</text></g>`,
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
