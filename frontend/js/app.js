import { api } from "./api.js";
import { ROLES, layout, renderSvg, roleColor } from "./diagram.js";
import { confirmDialog, messageDialog } from "./dialog.js";
import { el } from "./dom.js";
import { renderForm } from "./form-ui.js";
import { normalize } from "./model.js";

const app = document.getElementById("app");

const routes = [
  [/^#\/?$/, "home", pageHome],
  [/^#\/fill\/(.+)$/, "home", pageFill],
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
    app.classList.toggle("wide", page === pageDiagram || page === pageFill);
    app.classList.toggle("full", page === pageSystem);
    app.replaceChildren(el("p", { class: "muted" }, "Loading…"));
    try {
      const content = await page(...match.slice(1).map(decodeURIComponent));
      if (token === routeToken) app.replaceChildren(...[content].flat(Infinity));
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
    if (!model.servers.length) {
      body.replaceChildren(el("p", { class: "muted empty" }, "Give a server a name to see it here."));
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
        const conns = (m.connections || []).length;
        return el("li", {},
          el("a", { href: systemHref(m.system) },
            el("span", { class: "system-name" }, m.system),
            el("span", { class: "system-meta" },
              (m.sites || []).length ? (m.sites || []).map((x) => (x === m.dr_site ? `${x} (DR)` : x)).join(" · ") : "No sites",
              " — ",
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
  const { width, height } = layout([model], options);
  const file = fileName(model.system);

  const canvas = el("div", { class: "canvas" });
  if ((model.servers || []).length || (model.sites || []).length) {
    canvas.innerHTML = renderSvg([model], { ...options, background: false }); // safe: diagram.js escapes every text value
  } else {
    canvas.append(el("p", { class: "muted empty" }, "No servers described yet."));
  }

  const connections = model.connections || [];
  const table = connections.length
    ? el("table", { class: "connections" },
        el("thead", {}, el("tr", {}, ["From", "To", "Protocol", "Ports"].map((h) => el("th", {}, h)))),
        el("tbody", {}, connections.map((c) =>
          el("tr", {},
            el("td", {}, c.from),
            el("td", {}, `${c.both ? "↔" : "→"} ${c.to}`),
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
    ROLES.map((r) => el("span", { style: `--swatch:${roleColor(r)}` }, r)));

  return [
    back,
    el("div", { class: "system-head" },
      el("h1", {}, model.system),
      el("div", { class: "actions" },
        el("button", { type: "button", class: "btn ghost small", onclick: () => download(`${file}.svg`, new Blob([svgFile], { type: "image/svg+xml" })) }, "SVG"),
        el("button", { type: "button", class: "btn ghost small", onclick: async () => download(`${file}.png`, await svgToPng(svgFile, width, height)) }, "PNG"),
        el("button", { type: "button", class: "btn ghost small", onclick: () => download(`${file}.json`, new Blob([JSON.stringify(model, null, 2)], { type: "application/json" })) }, "Data (JSON)"),
        el("button", { type: "button", class: "btn danger small", onclick: (e) => deleteSystem(model.system, e.currentTarget) }, "Delete"))),
    legend,
    canvas,
    table ? el("h2", { class: "section-title" }, "Connections between servers") : null,
    table,
    linksTable ? el("h2", { class: "section-title" }, "Connects to other systems") : null,
    linksTable,
  ];
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
