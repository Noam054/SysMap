import { api } from "./api.js";
import { ROLES, layout, renderSvg, roleColor, skippingFrames } from "./diagram.js";
import { confirmDialog, messageDialog } from "./dialog.js";
import { el } from "./dom.js";
import { renderForm } from "./form-ui.js";
import { normalize } from "./model.js";

const app = document.getElementById("app");

const routes = [
  [/^#\/?$/, "home", pageHome],
  [/^#\/fill\/(.+)$/, "home", pageFill],
  [/^#\/edit\/(.+)$/, "diagram", pageEdit],
  [/^#\/submissions$/, "submissions", pageSubmissions],
  [/^#\/diagram$/, "diagram", pageDiagram],
  [/^#\/diagram\/(.+)$/, "diagram", pageSystem],
];

let routeToken = 0;

async function route() {
  const hash = location.hash || "#/";
  const token = ++routeToken;
  for (const [pattern, nav, page] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    app.classList.toggle("wide", page === pageDiagram);
    app.classList.toggle("fill", page === pageFill || page === pageEdit);
    app.classList.toggle("full", page === pageSystem);
    app.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    try {
      const content = await page(...match.slice(1).map(decodeURIComponent));
      if (token === routeToken) app.replaceChildren(...[content].flat(Infinity).filter((x) => x != null)); // a page leaves out empty sections as null
    } catch (err) {
      if (token === routeToken) app.replaceChildren(el("div", { class: "banner error" }, err.message || String(err)));
    }
    return;
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", route);
route();

// ---------- pages ----------

async function pageHome() {
  const list = await api.questionnaires();
  return [
    el("h1", {}, "Questionnaires"),
    el("p", { class: "muted" }, "Pick a questionnaire and describe your system. The answers feed the architecture diagram."),
    list.length
      ? list.map((q) =>
          el("div", { class: "card card-row" },
            el("div", {}, el("h2", {}, q.title), el("span", { class: "muted" }, `Version ${q.version}`)),
            el("a", { class: "btn", href: `#/fill/${encodeURIComponent(q.id)}` }, "Fill in")))
      : el("div", { class: "banner error" }, "No questionnaires found. Add a JSON file to backend/questionnaires/."),
  ];
}

async function pageFill(id) {
  const definition = await api.questionnaire(id);
  const preview = livePreview();
  const form = renderForm(definition, {
    onChange: preview.update,
    onSubmit: async (answers) => {
      const saved = await api.submit(definition.id, answers);
      app.replaceChildren(
        el("div", { class: "banner ok" }, `Saved. Thank you! The answers for “${saved.system}” are now part of the diagram.`),
        el("div", { class: "actions" },
          el("a", { class: "btn", href: systemHref(saved.system) }, "View the diagram"),
          el("a", {
            class: "btn ghost",
            href: `#/fill/${encodeURIComponent(definition.id)}`,
            // Same address as now, so the browser fires no hashchange: draw the empty form ourselves.
            onclick: (e) => { e.preventDefault(); route(); },
          }, "Describe another system"),
          el("a", { class: "btn ghost", href: "#/submissions" }, "All submissions")),
      );
      window.scrollTo({ top: 0 });
    },
  });
  return [
    el("h1", {}, definition.title),
    el("div", { class: "fill-layout" }, el("div", { class: "fill-form" }, form), preview.node),
  ];
}

// Edit a system's answers: the form starts from its newest answers, in the questionnaire version they were
// given in (an older version's answers would not fit a newer form). Saving adds a new submission; the earlier
// ones stay under Submissions. A new system name renames the system.
async function pageEdit(name) {
  const saved = await api.systemAnswers(name);
  const definition = await api.questionnaire(saved.questionnaire, saved.version);
  const latest = (await api.questionnaires()).find((q) => q.id === definition.id);
  const preview = livePreview();
  const form = renderForm(definition, {
    initial: saved.answers,
    submitLabel: "Save changes",
    onChange: preview.update,
    onSubmit: async (answers) => {
      const result = await api.submit(definition.id, answers, { version: definition.version, replaces: name });
      location.hash = systemHref(result.system);
    },
  });
  return [
    el("a", { class: "back", href: systemHref(name) }, `← Back to ${name}`),
    el("h1", {}, `Edit “${name}”`),
    latest && latest.version > definition.version
      ? el("p", { class: "banner info" },
        `These answers were given with version ${definition.version} of “${definition.title}”, so they are edited in that version. ` +
        `To use the newest questions (version ${latest.version}), fill in the questionnaire again.`)
      : null,
    el("div", { class: "fill-layout" }, el("div", { class: "fill-form" }, form), preview.node),
  ];
}

// The diagram beside the form, redrawn on every change. Nothing is saved until "Save answers".
function livePreview() {
  const title = el("h2", {});
  const body = el("div", { class: "canvas small" });
  const node = el("aside", { class: "live", "aria-label": "Live diagram" },
    el("p", { class: "live-label" }, "Live diagram"),
    title,
    body,
    el("p", { class: "muted small" }, "Updates as you type. Nothing is saved until you press “Save answers”."));

  const update = (answers) => {
    const model = normalize(answers);
    title.textContent = model.system || "Your system";
    if (!model.servers.length && !model.segments.length) {
      body.replaceChildren(el("p", { class: "muted empty" }, "Name a segment or a server to see it here."));
      return;
    }
    body.innerHTML = renderSvg([model], { showSystems: false, background: false }); // safe: diagram.js escapes every text value
  };
  return { node, update };
}

async function pageSubmissions() {
  const rows = await api.submissions();
  const detail = el("div", {});

  const show = async (id) => {
    detail.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    try {
      const full = await api.submission(id);
      detail.replaceChildren(
        el("h2", {}, `${full.system} — raw answers`),
        el("pre", {}, JSON.stringify(full.answers, null, 2)),
        el("h2", {}, "Understood by the diagram"),
        el("pre", {}, JSON.stringify(full.normalized, null, 2)),
      );
    } catch (err) {
      detail.replaceChildren(el("div", { class: "banner error" }, err.message));
    }
  };

  return [
    el("h1", {}, "Submissions"),
    rows.length
      ? el("table", {},
          el("thead", {}, el("tr", {}, ["System", "Questionnaire", "Version", "Saved", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.map((r) =>
            el("tr", {},
              el("td", {}, r.system),
              el("td", {}, r.questionnaire),
              el("td", {}, r.version),
              el("td", {}, new Date(r.created_at).toLocaleString()),
              el("td", {}, el("button", { type: "button", class: "btn ghost small", onclick: () => show(r.id) }, "View"))))))
      : el("p", { class: "muted" }, "Nothing has been submitted yet."),
    detail,
  ];
}

const systemHref = (name) => `#/diagram/${encodeURIComponent(name)}`;

// Diagram tab: the list of systems. Each one opens its own full-page diagram.
async function pageDiagram() {
  const models = (await api.model())
    .filter((m) => m && m.system)
    .sort((a, b) => a.system.localeCompare(b.system));
  if (!models.length) {
    return [
      el("h1", {}, "Diagram"),
      el("p", { class: "muted" }, "No data yet. Fill in a questionnaire first, and the diagram will appear here."),
      el("a", { class: "btn", href: "#/" }, "Go to questionnaires"),
    ];
  }
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return [
    el("h1", {}, "Diagram"),
    el("p", { class: "muted" }, "Choose a system to see its diagram."),
    el("ul", { class: "system-list" },
      models.map((m) => {
        const servers = (m.servers || []).length;
        const segs = (m.segments || []).length;
        const conns = (m.connections || []).length;
        return el("li", {},
          el("a", { href: systemHref(m.system) },
            el("span", { class: "system-name" }, m.system),
            el("span", { class: "system-meta" },
              (m.sites || []).length ? (m.sites || []).map((x) => (x === m.dr_site ? `${x} (DR)` : x)).join(" · ") : "No sites",
              " — ",
              segs ? `${count(segs, "segment", "segments")}, ` : "",
              count(servers, "server", "servers"),
              conns ? `, ${count(conns, "connection", "connections")}` : ""),
            el("span", { class: "arrow", "aria-hidden": "true" }, "→")));
      })),
  ];
}

// One system, full page: its diagram on a dotted canvas, then its connections.
async function pageSystem(name) {
  const model = (await api.model()).find((m) => m && m.system === name);
  const back = el("a", { class: "back", href: "#/diagram" }, "← All systems");
  if (!model) {
    return [back, el("h1", {}, name), el("p", { class: "muted" }, "This system is not in the diagram (it may have been deleted).")];
  }

  const options = { showSystems: false };
  const svgFile = renderSvg([model], options); // white background, for the downloads
  const { width, height, endpoints } = layout([model], options);
  const file = fileName(model.system);

  // With an endpoints zone the picture fills the card, so the zone sits on the card's sides and bottom.
  const canvas = el("div", { class: endpoints ? "canvas flush" : "canvas" });
  if ((model.servers || []).length || (model.sites || []).length) {
    canvas.innerHTML = renderSvg([model], { ...options, background: false }); // safe: diagram.js escapes every text value
  } else {
    canvas.append(el("p", { class: "muted empty" }, "No servers described yet."));
  }

  const segments = model.segments || [];
  const serverNames = new Set((model.servers || []).flatMap((x) => [x.key || x.name, x.name]));
  // A connection end can be a server or a whole segment: say which (and its site), so the table reads like a
  // firewall rule. Servers and segments are named "DB (Sapir)"; older saved answers use the name alone.
  const endText = (n) => {
    if (serverNames.has(n)) return n;
    const g = segments.find((x) => x.key === n) || segments.find((x) => x.name === n);
    return g ? `${g.name} (segment in ${g.site})` : n;
  };
  const segTable = segments.length
    ? el("table", { class: "connections" },
        el("thead", {}, el("tr", {}, ["Site", "Segment", "Subnet", "Servers"].map((h) => el("th", {}, h)))),
        el("tbody", {}, segments.map((g) =>
          el("tr", {},
            el("td", {}, g.site),
            el("td", {}, g.name),
            el("td", { class: "mono" }, g.subnet || "—"),
            el("td", {}, (model.servers || []).filter((x) => x.segment === g.name && x.site === g.site).map((x) => x.name).join(", ") || "—")))))
    : null;

  const connections = model.connections || [];
  const table = connections.length
    ? el("table", { class: "connections" },
        el("thead", {}, el("tr", {}, ["From", "To", "Protocol", "Ports"].map((h) => el("th", {}, h)))),
        el("tbody", {}, connections.map((c) =>
          el("tr", {},
            el("td", {}, endText(c.from)),
            el("td", {}, `${c.both ? "↔" : "→"} ${endText(c.to)}`),
            el("td", {}, c.protocol),
            el("td", {}, c.ports)))))
    : null;

  const links = model.links || [];
  const linksTable = links.length
    ? el("table", { class: "connections" },
        el("thead", {}, el("tr", {}, ["System", "Protocol / port"].map((h) => el("th", {}, h)))),
        el("tbody", {}, links.map((l) => el("tr", {}, el("td", {}, l.to), el("td", {}, l.protocol || "")))))
    : null;

  const legend = el("div", { class: "legend" },
    ROLES.map((r) => el("span", { style: `--swatch:${roleColor(r)}` }, r)),
    el("span", { class: "legend-seg" }, "network segment (subnet)"),
    el("span", { class: "legend-idle" }, "grey: turned off, or open but not in use"));

  const steps = model.skipping || [];
  const player = steps.length ? skippingPlayer(model, canvas) : null;
  const stepsTable = steps.length
    ? el("table", { class: "connections" },
        el("thead", {}, el("tr", {}, ["Step", "Action", "Server", "Note"].map((h) => el("th", {}, h)))),
        el("tbody", {}, steps.map((st, i) =>
          el("tr", {},
            el("td", {}, String(i + 1)),
            el("td", {}, st.action === "on" ? "Turn on" : "Turn off"),
            el("td", {}, st.server),
            el("td", {}, st.note || "—")))))
    : null;

  return [
    back,
    el("div", { class: "system-head" },
      el("h1", {}, model.system),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn ghost small", onclick: () => download(`${file}.svg`, new Blob([svgFile], { type: "image/svg+xml" })) }, "SVG"),
        el("button", { type: "button", class: "btn ghost small", onclick: async () => download(`${file}.png`, await svgToPng(svgFile, width, height)) }, "PNG"),
        el("button", { type: "button", class: "btn ghost small", onclick: () => download(`${file}.json`, new Blob([JSON.stringify(model, null, 2)], { type: "application/json" })) }, "Data (JSON)"),
        player ? player.button : null,
        el("a", { class: "btn small", href: `#/edit/${encodeURIComponent(model.system)}` }, "Edit answers"),
        el("button", { type: "button", class: "btn danger small", onclick: (e) => deleteSystem(model.system, e.currentTarget) }, "Delete"))),
    legend,
    canvas,
    segTable ? el("h2", { class: "section-title" }, "Network segments") : null,
    segTable,
    table ? el("h2", { class: "section-title" }, "Connections (port openings)") : null,
    table,
    linksTable ? el("h2", { class: "section-title" }, "Connects to other systems") : null,
    linksTable,
    stepsTable ? el("h2", { class: "section-title" }, "Skipping process") : null,
    stepsTable,
  ];
}

// "Play skipping": first a pop-up with a short summary, then the diagram walks through the steps. The picture
// never moves; each step only switches which servers are off and which segments and connections are grey
// (see skippingFrames).
const STEP_MS = 1300;
function skippingPlayer(model, canvas) {
  const frames = skippingFrames(model);
  const button = el("button", { type: "button", class: "btn small skip-btn" }, "▶ Play skipping");
  let timers = [];

  const show = (frame, animate) => {
    const svg = canvas.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll(".srv").forEach((g) => g.classList.toggle("off", frame.offServers.has(g.dataset.key)));
    svg.querySelectorAll(".seg").forEach((g) => g.classList.toggle("idle", frame.idleSegments.has(g.dataset.seg)));
    svg.querySelectorAll("[data-conn]").forEach((g) => g.classList.toggle("idle", frame.idleConnections.has(Number(g.dataset.conn))));
    if (!animate) return;
    // The server of the step pulses; communication that starts is drawn in along its line.
    svg.querySelectorAll(".srv.pulse").forEach((g) => g.classList.remove("pulse"));
    const srv = [...svg.querySelectorAll(".srv")].find((g) => g.dataset.key === frame.server);
    if (srv) { void srv.getBBox(); srv.classList.add("pulse"); }
    for (const i of frame.started) {
      svg.querySelectorAll(`.conn[data-conn="${i}"] path`).forEach((path) => {
        const len = path.getTotalLength();
        path.style.transition = "none";
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        void path.getBoundingClientRect();
        path.style.transition = "stroke-dashoffset .8s ease-out, stroke .4s";
        path.style.strokeDashoffset = "0";
        timers.push(setTimeout(() => path.removeAttribute("style"), 900));
      });
    }
  };
  const stop = () => { timers.forEach(clearTimeout); timers = []; };

  const play = () => {
    button.disabled = true;
    show(frames[0], false);
    frames.slice(1).forEach((f, i) => timers.push(setTimeout(() => show(f, true), 300 + i * STEP_MS)));
    timers.push(setTimeout(() => {
      button.disabled = false;
      button.dataset.state = "done";
      button.textContent = "↺ Reset";
    }, 300 + (frames.length - 1) * STEP_MS));
  };

  button.addEventListener("click", async () => {
    stop();
    if (button.dataset.state === "done") { // Reset: back to the start, as the answers describe it
      show(frames[0], false);
      button.dataset.state = "";
      button.textContent = "▶ Play skipping";
      return;
    }
    if (await confirmDialog({ title: `Skipping process – ${model.system}`, message: skippingSummary(model, frames), confirmLabel: "▶ Play" })) play();
  });
  return { button };
}

// The pop-up before the animation: the steps in one line each, then which communication moves.
function skippingSummary(model, frames) {
  const conns = model.connections || [];
  const first = frames[0];
  const last = frames.at(-1);
  const line = (i) => `${conns[i].from} ${conns[i].both ? "↔" : "→"} ${conns[i].to}`;
  const stops = [...last.idleConnections].filter((i) => !first.idleConnections.has(i)).map(line);
  const starts = [...first.idleConnections].filter((i) => !last.idleConnections.has(i)).map(line);
  const group = (title, items, cls) => items.length
    ? el("div", { class: `skip-group ${cls}` }, el("strong", {}, title), el("ul", {}, items.map((t) => el("li", {}, t))))
    : null;
  return el("div", { class: "skip-summary" },
    el("ol", {}, (model.skipping || []).map((st) =>
      el("li", {}, el("span", { class: `skip-action ${st.action}` }, st.action === "on" ? "Turn on" : "Turn off"), " ", st.server,
        st.note ? el("span", { class: "muted" }, ` – ${st.note}`) : null))),
    group("Communication that stops", stops, "stops"),
    group("Communication that starts", starts, "starts"),
    stops.length || starts.length ? null : el("p", { class: "muted" }, "No communication changes."));
}

async function deleteSystem(name, button) {
  const ok = await confirmDialog({
    title: `Delete “${name}”?`,
    message: "This removes the system's diagram and all of its saved answers. It cannot be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  button.disabled = true;
  try {
    await api.deleteSystem(name);
    location.hash = "#/diagram"; // back to the list, without it
  } catch (err) {
    button.disabled = false;
    await messageDialog({ title: "Could not delete", message: `“${name}” was not deleted: ${err.message}` });
  }
}

const fileName = (name) => "sysmap-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "system");

// ---------- downloads ----------

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function svgToPng(svgText, width, height) {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not draw the diagram as an image"));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
