// Renders a questionnaire definition (JSON) as an HTML form.
import { el } from "./dom.js";
import { choiceOptions, fillLabel, isVisible, parseServerErrors, pruneHidden, validate } from "./form-logic.js";

// How a row's site is found: its own "site" answer, else the nearest one around it, else the primary site.
const SITE_LABEL = "{site|primary_site}";

// onChange(answers), optional: called after every change with the answers as they would be sent.
export function renderForm(definition, { onSubmit, onChange, submitLabel = "Save answers" }) {
  const state = {}; // the answers being typed
  const watchers = []; // fields that can show/hide depending on other answers
  const dynamicChoices = []; // choice fields whose options come from other answers ("options_from")
  const liveTexts = []; // small texts that follow the answers: a row's name in its header, "in Ofek"
  const collapsed = new WeakMap(); // row -> true when the user minimized it (kept when the list is redrawn)
  const collapsedLists = new Set(); // paths of minimized list sections
  const drawers = new Map(); // a list's rows (the array) -> the function that redraws that list

  // A field is dropped from these lists once it has been on the page and is not any more (its row was
  // removed, its pop-up closed). Fields that were never on the page yet (still being built) are kept.
  const gone = (entry, node) => {
    if (node.isConnected) entry.seen = true;
    return !node.isConnected && entry.seen;
  };

  // Rebuild the options of "options_from" choices, keeping the current answer selected.
  const refreshChoices = () => {
    for (let i = dynamicChoices.length - 1; i >= 0; i--) {
      const { select, question, rowState, owners } = dynamicChoices[i];
      if (gone(dynamicChoices[i], select)) {
        dynamicChoices.splice(i, 1); // belongs to a removed row
        continue;
      }
      (question.multiple ? fillMulti : fillChoice)(select, question, rowState, owners);
    }
  };

  // Several options may be picked ("multiple"): a box of checkboxes. Nothing is picked at the start.
  const fillMulti = (box, question, rowState, owners) => {
    const options = choiceOptions(question, state, owners);
    const picked = Array.isArray(rowState[question.id]) ? rowState[question.id] : [];
    const stale = picked.filter((o) => !options.includes(o)); // renamed or removed: shown so the user notices
    const all = [...options, ...stale];
    box.classList.toggle("disabled", !all.length);
    box.replaceChildren(...(all.length ? all.map((o) => {
      const input = el("input", {
        type: "checkbox", value: o,
        onchange: (e) => {
          const now = (Array.isArray(rowState[question.id]) ? rowState[question.id] : []).filter((x) => x !== o);
          if (e.target.checked) now.push(o);
          rowState[question.id] = all.filter((x) => now.includes(x)); // keep the options' order
          refreshVisibility();
        },
      });
      input.checked = picked.includes(o);
      return el("label", { class: "multi-option" }, input, " ", stale.includes(o) ? `${o} (no longer in the list)` : o);
    }) : [el("span", { class: "muted" }, "Nothing to choose yet")]));
  };

  // Dropdowns start on their first option (no empty "choose" entry).
  const fillChoice = (select, question, rowState, owners) => {
    const options = choiceOptions(question, state, owners);
    if (rowState[question.id] === undefined && options.length) rowState[question.id] = options[0];
    const current = rowState[question.id];
    // A server that was renamed or removed stays visible (marked) so the user notices and fixes it.
    const stale = current !== undefined && !options.includes(current) ? [current] : [];
    // Nothing to choose (e.g. no segments yet): an empty, greyed-out box until there is.
    select.disabled = !options.length && !stale.length;
    select.replaceChildren(
      ...options.map((o) => el("option", { value: o }, o)),
      ...stale.map((o) => el("option", { value: o }, `${o} (no longer in the list)`)));
    select.value = current ?? "";
  };

  const notify = () => {
    if (onChange) onChange(pruneHidden(definition.questions, state));
  };

  const refreshTexts = () => {
    for (let i = liveTexts.length - 1; i >= 0; i--) {
      const { node, compute } = liveTexts[i];
      if (gone(liveTexts[i], node)) liveTexts.splice(i, 1);
      else node.textContent = compute();
    }
  };

  const refreshVisibility = () => {
    notifyLater();
    refreshChoices();
    refreshTexts();
    for (let i = watchers.length - 1; i >= 0; i--) {
      const w = watchers[i];
      if (gone(w, w.node)) {
        watchers.splice(i, 1); // belongs to a removed row
        continue;
      }
      w.node.hidden = !isVisible(w.question, w.state);
    }
  };

  // owners: the list rows we are inside, outermost first, as { questions, row } (see form-logic.js):
  // they decide which lists "options_from" reads, and a row never offers itself.
  const buildQuestions = (questions, rowState, path, owners = []) =>
    el("div", { class: "fields" }, questions.map((q) => buildField(q, rowState, path, owners)));

  function buildField(q, rowState, path, owners) {
    const fieldPath = path + q.id;
    const id = "f_" + fieldPath.replace(/[^A-Za-z0-9]/g, "_");
    const isList = q.type === "list";

    const labelText = [q.label, q.required ? el("span", { class: "req", title: "Required" }, " *") : null];
    const help = q.help && (!path || isList) ? el("p", { class: "help" }, q.help) : null;
    let node;
    if (isList && q.collapsible === false) {
      // A list that is not a section of its own (e.g. other sites): its rows, then its "+ Add" button.
      node = el("div", { class: "field field-list plain-list", "data-path": fieldPath },
        help, buildControl(q, rowState, fieldPath, id, owners),
        el("p", { class: "field-error", role: "alert", hidden: true }));
    } else if (isList) {
      // A list is a section the user can minimize: its header stays, its rows and help are hidden.
      const body = el("div", { class: "list-body" }, help, buildControl(q, rowState, fieldPath, id, owners));
      const toggle = collapseButton(() => collapsedLists.has(fieldPath), (on) => {
        if (on) collapsedLists.add(fieldPath);
        else collapsedLists.delete(fieldPath);
        node.classList.toggle("collapsed", on);
      });
      node = el("div", { class: "field field-list", "data-path": fieldPath },
        el("div", { class: "label section-head" }, toggle, el("span", {}, labelText)),
        body,
        el("p", { class: "field-error", role: "alert", hidden: true }));
      node.classList.toggle("collapsed", collapsedLists.has(fieldPath));
      node.expand = () => { collapsedLists.delete(fieldPath); node.classList.remove("collapsed"); toggle.sync(); };
    } else {
      node = el("div", { class: `field field-${q.type}`, "data-path": fieldPath },
        // Inside a row the help text is a tooltip on the label, to keep the rows short.
        el("label", { for: id, title: path ? q.help : undefined }, labelText),
        help,
        buildControl(q, rowState, fieldPath, id, owners),
        el("p", { class: "field-error", role: "alert", hidden: true }));
    }
    node.hidden = !isVisible(q, rowState);
    watchers.push({ node, question: q, state: rowState });
    return node;
  }

  function buildControl(q, rowState, fieldPath, id, owners) {
    switch (q.type) {
      case "text": {
        const input = el("input", {
          type: "text", id, autocomplete: "off", placeholder: q.placeholder,
          oninput: (e) => { rowState[q.id] = e.target.value; refreshVisibility(); },
        });
        input.value = rowState[q.id] ?? "";
        return input;
      }
      case "number": {
        const input = el("input", {
          type: "number", id, step: "any", min: q.min, max: q.max, placeholder: q.placeholder,
          oninput: (e) => {
            if (e.target.value === "") delete rowState[q.id];
            else rowState[q.id] = Number(e.target.value);
            refreshVisibility();
          },
        });
        input.value = rowState[q.id] ?? "";
        return input;
      }
      case "boolean": {
        // Yes/no questions start on "No".
        if (typeof rowState[q.id] !== "boolean") rowState[q.id] = false;
        const select = el("select", {
          id,
          onchange: (e) => {
            rowState[q.id] = e.target.value === "yes";
            refreshVisibility();
          },
        },
          el("option", { value: "no" }, "No"),
          el("option", { value: "yes" }, "Yes"));
        select.value = rowState[q.id] ? "yes" : "no";
        return select;
      }
      case "choice": {
        if (q.multiple) {
          const box = el("div", { class: "multi-choice", id, role: "group" });
          fillMulti(box, q, rowState, owners);
          dynamicChoices.push({ select: box, question: q, rowState, owners });
          return box;
        }
        const select = el("select", {
          id,
          onchange: (e) => {
            rowState[q.id] = e.target.value;
            refreshVisibility();
          },
        });
        fillChoice(select, q, rowState, owners);
        if (q.options_from || q.exclude || q.differs_from) dynamicChoices.push({ select, question: q, rowState, owners });
        return select;
      }
      case "list":
        return buildList(q, rowState, fieldPath, owners);
      default:
        return el("p", { class: "muted" }, `Unsupported question type: ${q.type}`);
    }
  }

  // A small ▾/▸ button that minimizes (or opens again) a section or a row.
  function collapseButton(isOn, set) {
    const btn = el("button", { type: "button", class: "collapse-toggle" });
    btn.sync = () => {
      const on = isOn();
      btn.setAttribute("aria-expanded", String(!on));
      btn.title = on ? "Open" : "Minimize";
      btn.textContent = on ? "▸" : "▾";
    };
    btn.addEventListener("click", () => {
      const open = isOn();
      set(!open);
      btn.sync();
      // Opening a block opens every minimized block inside it too.
      if (open) btn.closest(".field-list, .row-card")?.querySelectorAll(".field-list.collapsed, .row-card.collapsed").forEach((n) => n.expand());
    });
    btn.sync();
    return btn;
  }

  // The text answers of a row that best name it (e.g. a server's name), for its header.
  const rowName = (item, row) => {
    const q = item.find((x) => x.type === "text" && typeof row[x.id] === "string" && row[x.id].trim());
    return q ? row[q.id].trim() : "";
  };

  function buildList(q, rowState, fieldPath, owners) {
    // A list starts with one empty row, or with none when it has "start_empty" (e.g. other sites).
    if (!Array.isArray(rowState[q.id])) rowState[q.id] = q.start_empty ? [] : [{}];
    if (!rowState[q.id].length && !q.start_empty) rowState[q.id].push({});
    const rows = rowState[q.id];
    const label = q.row_label || "Item";
    const box = el("div", { class: "rows" });
    // "in Ofek" next to each row, so the user always sees which site it belongs to (a site block shows its own site).
    const ownSite = q.item.some((x) => x.id === "site");
    // Only lists that belong to a site get the note: those asked again inside each site block (segments,
    // servers). A list for all sites (e.g. v4 connections) does not.
    const perSite = ownSite || owners.length > 0 ||
      definition.questions.some((b) => b.type === "list" && b.item.some((x) => x.id === q.id && x.type === "list"));
    const siteNote = (row) => {
      if (!perSite) return "";
      const v = fillLabel(SITE_LABEL, "", [row, ...owners.map((f) => f.row).reverse(), state]);
      return v === "?" ? "" : ownSite ? v : `in ${v}`;
    };

    const draw = () => {
      box.replaceChildren(
        ...(rows.length ? [] : [el("p", { class: "muted none" }, `No ${label.toLowerCase()} added.`)]),
        ...rows.map((row, i) => {
          const card = el("div", { class: "row-card" });
          const setCollapsed = (on) => {
            if (on) collapsed.set(row, true);
            else collapsed.delete(row);
            card.classList.toggle("collapsed", on);
          };
          const toggle = collapseButton(() => collapsed.has(row), setCollapsed);
          card.expand = () => { setCollapsed(false); toggle.sync(); };
          const title = el("span", { class: "row-name" }, rowName(q.item, row));
          liveTexts.push({ node: title, compute: () => rowName(q.item, row) });
          const where = el("span", { class: "row-site" }, siteNote(row));
          liveTexts.push({ node: where, compute: () => siteNote(row) });
          const actions = [];
          if (q.duplicate) actions.push(el("button", { type: "button", class: "btn ghost small", title: `Add a copy of this ${label.toLowerCase()} in the same site`, onclick: () => duplicateRow(q, row, here()) }, "Duplicate"));
          actions.push(el("button", {
            type: "button", class: "btn ghost small",
            onclick: () => { rows.splice(i, 1); draw(); refreshVisibility(); },
          }, "Remove"));
          card.append(
            el("div", { class: "row-head" },
              toggle,
              el("strong", {}, `${label} ${i + 1}`), title, where,
              el("span", { class: "row-actions" }, actions)),
            buildQuestions(q.item, row, `${fieldPath}[${i}].`, [...owners, { questions: q.item, row }]));
          card.classList.toggle("collapsed", collapsed.has(row));
          return card;
        }),
      );
      refreshTexts();
    };
    drawers.set(rows, draw);
    draw();
    // This list as a place to add rows to (see siteTargets).
    const here = () => siteTargets(q).find((t) => t.rows === rows) || { rows, frames: owners, path: fieldPath, label: siteNote({}) };

    return el("div", { class: "list-buttons" },
      box,
      el("button", {
        type: "button", class: "btn small add-btn",
        onclick: () => { rows.push({}); draw(); refreshVisibility(); },
      }, `+ ${q.add_label || `Add ${label.toLowerCase()}`}`),
      q.copy_from_site
        ? el("button", {
          type: "button", class: "btn small ghost",
          title: `Pull a ${label.toLowerCase()} you already described in another site into this site`,
          onclick: () => copyFromSite(q, here()),
        }, "Copy from another site…")
        : null);
  }

  // ---- duplicate a row, or copy it to another site, through a pop-up with the new row's answers ----

  // Every place the same list exists: the top level, and each row of a top-level list that has it inside
  // (for servers: the primary site and each "Add site" block). Named by their site.
  function siteTargets(q) {
    const targets = [];
    const add = (container, rowsOwner, frames, path) => {
      if (!Array.isArray(rowsOwner[q.id])) rowsOwner[q.id] = [];
      const name = fillLabel(SITE_LABEL, "", [...frames.map((f) => f.row).reverse(), state]);
      targets.push({ rows: rowsOwner[q.id], frames, path: `${path}${q.id}`, label: name === "?" ? `Site ${targets.length + 1}` : name });
    };
    if (definition.questions.some((x) => x.id === q.id && x.type === "list")) add(definition.questions, state, [], "");
    for (const block of definition.questions) {
      if (block.type !== "list" || !block.item.some((x) => x.id === q.id && x.type === "list")) continue;
      (Array.isArray(state[block.id]) ? state[block.id] : []).forEach((row, k) =>
        add(block.item, row, [{ questions: block.item, row }], `${block.id}[${k}].`));
    }
    return targets;
  }

  // The question that names a row (e.g. a server's name): its first text question that must be different.
  const nameQuestion = (q) => q.item.find((x) => x.type === "text" && (x.distinct || x.unique));

  // Names already used where a new row's name must be different: the same list for "distinct" (one site),
  // every answer of the group for "unique" (all sites). Lower case.
  function usedNames(nameQ, rows) {
    const used = new Set();
    const add = (v) => { if (typeof v === "string" && v.trim()) used.add(v.trim().toLowerCase()); };
    if (nameQ.distinct) rows.forEach((r) => add(r && r[nameQ.id]));
    if (nameQ.unique) {
      const walk = (questions, answers) => {
        for (const x of questions) {
          const v = answers && answers[x.id];
          if (x.type === "list" && Array.isArray(v)) v.forEach((r) => walk(x.item, r));
          else if (x.unique === nameQ.unique) add(v);
        }
      };
      walk(definition.questions, state);
    }
    return used;
  }

  // "web-1" -> "web-2", "db" -> "db-2": the first name that is not used yet.
  function nextName(name, used) {
    const m = name.match(/^(.*?)(\d+)$/);
    const stem = m ? m[1] : `${name}-`;
    for (let n = m ? Number(m[2]) + 1 : 2; ; n++) if (!used.has(`${stem}${n}`.toLowerCase())) return `${stem}${n}`;
  }

  // Duplicate: a copy of the row in the same site, with the next free name.
  function duplicateRow(q, source, target) {
    const label = (q.row_label || "Item").toLowerCase();
    const copy = structuredClone(source);
    const nameQ = nameQuestion(q);
    if (nameQ && typeof copy[nameQ.id] === "string" && copy[nameQ.id].trim()) {
      copy[nameQ.id] = nextName(copy[nameQ.id].trim(), usedNames(nameQ, target.rows));
    }
    rowDialog({
      q, target, title: `Duplicate ${label}`,
      intro: `A new ${label} with the same answers is added below the others in this site. Change what is different.`,
      confirm: `Add ${label}`,
      start: () => copy,
    });
  }

  // Copy from another site: pull a row described in another site into this one. It keeps its name (another
  // site may have the same name); choices that depend on the site (e.g. the segment) are kept when this site
  // has the same option, and otherwise start again.
  function copyFromSite(q, target) {
    const label = (q.row_label || "Item").toLowerCase();
    const sources = siteTargets(q)
      .filter((t) => t.rows !== target.rows)
      .flatMap((t) => t.rows.map((row) => ({ row, text: `${rowName(q.item, row) || `(${label} without a name)`} — ${t.label}` })));
    if (!sources.length) {
      showDialog({
        title: `Copy ${label} from another site`,
        body: [el("p", {}, `No other site has a ${label} yet. Describe it in its own site first, then copy it here.`)],
        actions: [["OK", true]],
      });
      return;
    }
    let source = sources[0];
    const picker = el("div", { class: "field" },
      el("label", { for: "copy-source" }, `Which ${label}?`),
      el("select", {
        id: "copy-source",
        onchange: (e) => { source = sources[Number(e.target.value)]; dialogFields.redraw(); },
      }, sources.map((x, i) => el("option", { value: String(i) }, x.text))));
    const dialogFields = rowDialog({
      q, target, title: `Copy ${label} from another site`,
      intro: `The ${label} is added to ${target.label || "this site"} with the same answers. Change what is different here.`,
      confirm: `Copy ${label}`,
      picker,
      start: () => {
        const copy = structuredClone(source.row);
        const frames = [...target.frames, { questions: q.item, row: copy }];
        for (const x of q.item) {
          if (x.type === "choice" && x.options_from && !choiceOptions(x, state, frames).includes(copy[x.id])) delete copy[x.id];
        }
        return copy;
      },
    });
  }

  // The pop-up with the new row's questions. start() gives the new row's answers (called again on redraw).
  // The new row is checked as part of the whole form; the pop-up stays open while it has mistakes.
  function rowDialog({ q, target, title, intro, confirm, picker, start }) {
    let copy;
    const fieldsBox = el("div", {});
    const redraw = () => {
      copy = start();
      fieldsBox.replaceChildren(buildQuestions(q.item, copy, `${target.path}[${target.rows.length}].`, [...target.frames, { questions: q.item, row: copy }]));
      refreshVisibility();
    };
    redraw();
    showDialog({
      title,
      body: [el("p", { class: "muted" }, intro), picker, fieldsBox],
      actions: [["Cancel", false], [confirm, true]],
      onConfirm: (dialog) => {
        target.rows.push(copy);
        const prefix = `${target.path}[${target.rows.length - 1}].`;
        const errors = [];
        for (const e of validate(definition.questions, state)) {
          if (e.path.startsWith(prefix)) errors.push(e);
          // A clash with a name used earlier in the form is reported on the other answer: point it at the copy.
          const other = e.message.match(/\(see ([^)]+)\)/);
          if (!e.path.startsWith(prefix) && other && other[1].startsWith(prefix)) {
            errors.push({ path: other[1], message: `Already used (see ${e.path})` });
          }
        }
        dialog.querySelectorAll(".has-error").forEach((n) => n.classList.remove("has-error"));
        dialog.querySelectorAll(".field-error").forEach((n) => { n.hidden = true; });
        if (errors.length) {
          target.rows.pop();
          for (const e of errors) {
            const node = dialog.querySelector(`[data-path="${CSS.escape(e.path)}"]`);
            if (!node) continue;
            node.classList.add("has-error");
            const msg = node.querySelector(":scope > .field-error");
            msg.textContent = e.message;
            msg.hidden = false;
          }
          return false;
        }
        const redrawList = drawers.get(target.rows);
        if (redrawList) redrawList();
        refreshVisibility();
        const node = form.querySelector(`[data-path="${CSS.escape(target.path)}"]`);
        if (node) {
          openAround(node);
          const cards = node.querySelectorAll(":scope .rows > .row-card");
          const added = cards[cards.length - 1];
          if (added) {
            added.scrollIntoView({ block: "center", behavior: "smooth" });
            added.classList.add("just-added");
            setTimeout(() => added.classList.remove("just-added"), 1600);
          }
        }
        return true;
      },
    });
    return { redraw };
  }

  // A pop-up drawn by the app. actions: [[label, isConfirm]]. onConfirm returns false to keep it open.
  function showDialog({ title, body, actions, onConfirm }) {
    const dialog = el("dialog", { class: "dialog dialog-wide questionnaire", "aria-labelledby": "row-dialog-title" });
    const close = () => { dialog.close(); dialog.remove(); };
    dialog.append(
      el("h2", { id: "row-dialog-title" }, title),
      ...body.filter(Boolean),
      el("div", { class: "dialog-actions" }, actions.map(([text, confirm]) =>
        el("button", {
          type: "button", class: confirm ? "btn" : "btn ghost",
          onclick: () => { if (!confirm || !onConfirm || onConfirm(dialog) !== false) close(); },
        }, text))));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    document.body.append(dialog);
    dialog.showModal();
  }

  // Open every minimized section and row around a node (e.g. one with a mistake to fix).
  function openAround(node) {
    for (let n = node; n && n !== form; n = n.parentElement) if (n.expand && n.classList.contains("collapsed")) n.expand();
  }

  // Minimize or open everything at once.
  const setAll = (on) => {
    form.querySelectorAll(".field-list, .row-card").forEach((n) => {
      const own = n.querySelector(":scope > .section-head > .collapse-toggle, :scope > .row-head > .collapse-toggle");
      if (on && own && !n.classList.contains("collapsed")) own.click();
      if (!on && n.classList.contains("collapsed")) n.expand();
    });
  };

  // ---- form shell: summary, submit, error display ----
  // Many changes in a row (fast typing) are reported once, a moment later.
  let pending = false;
  function notifyLater() {
    if (!onChange || pending) return;
    pending = true;
    setTimeout(() => { pending = false; notify(); }, 30);
  }

  const summary = el("div", { class: "banner error", role: "alert", hidden: true });
  const submitButton = el("button", { type: "submit", class: "btn" }, submitLabel);
  const toolbar = el("div", { class: "form-tools" },
    el("button", { type: "button", class: "btn ghost small", onclick: () => setAll(true) }, "Minimize all"),
    el("button", { type: "button", class: "btn ghost small", onclick: () => setAll(false) }, "Open all"));
  const form = el("form", { novalidate: true, class: "questionnaire" }, toolbar, summary, buildQuestions(definition.questions, state, ""),
    el("div", { class: "actions" }, submitButton));

  const clearErrors = () => {
    summary.hidden = true;
    summary.replaceChildren();
    form.querySelectorAll(".has-error").forEach((n) => n.classList.remove("has-error"));
    form.querySelectorAll(".field-error").forEach((n) => { n.hidden = true; n.textContent = ""; });
  };

  const showErrors = (errors, headline) => {
    summary.replaceChildren(
      headline || `Please fix ${errors.length} ${errors.length === 1 ? "answer" : "answers"}:`,
      el("ul", {}, errors.map((e) => el("li", {}, e.path ? `${e.path}: ${e.message}` : e.message))),
    );
    summary.hidden = false;
    let firstNode = null;
    for (const e of errors) {
      const node = form.querySelector(`[data-path="${CSS.escape(e.path)}"]`);
      if (!node) continue;
      openAround(node); // a mistake inside a minimized section or row must be visible
      node.classList.add("has-error");
      const msg = node.querySelector(":scope > .field-error");
      msg.textContent = e.message;
      msg.hidden = false;
      firstNode = firstNode || node;
    }
    (firstNode || summary).scrollIntoView({ block: "center", behavior: "smooth" });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    const answers = pruneHidden(definition.questions, state);
    const errors = validate(definition.questions, answers);
    if (errors.length) {
      showErrors(errors);
      return;
    }
    submitButton.disabled = true;
    try {
      await onSubmit(answers);
    } catch (err) {
      if (err.errors && err.errors.length) showErrors(parseServerErrors(err.errors), "The server did not accept these answers:");
      else showErrors([{ path: "", message: err.message || "Something went wrong" }], "Could not save:");
    } finally {
      submitButton.disabled = false;
    }
  });

  notifyLater(); // first picture, with the starting values
  return form;
}
