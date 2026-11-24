// Renders a questionnaire definition (JSON) as an HTML form.
import { el } from "./dom.js";
import { isVisible, parseServerErrors, pruneHidden, validate } from "./form-logic.js";

export function renderForm(definition, { onSubmit, submitLabel = "Save answers" }) {
  const state = {}; // the answers being typed
  const watchers = []; // fields that can show/hide depending on other answers

  const refreshVisibility = () => {
    for (let i = watchers.length - 1; i >= 0; i--) {
      const w = watchers[i];
      if (!w.node.isConnected) {
        watchers.splice(i, 1); // belongs to a removed row
        continue;
      }
      w.node.hidden = !isVisible(w.question, w.state);
    }
  };

  const buildQuestions = (questions, rowState, path) => questions.map((q) => buildField(q, rowState, path));

  function buildField(q, rowState, path) {
    const fieldPath = path + q.id;
    const id = "f_" + fieldPath.replace(/[^A-Za-z0-9]/g, "_");
    const isList = q.type === "list";

    const node = el(
      "div",
      { class: "field", "data-path": fieldPath },
      el(isList ? "div" : "label", { class: isList ? "label" : undefined, for: isList ? undefined : id },
        q.label,
        q.required ? el("span", { class: "req", title: "Required" }, " *") : null),
      q.help ? el("p", { class: "help" }, q.help) : null,
      buildControl(q, rowState, fieldPath, id),
      el("p", { class: "field-error", role: "alert", hidden: true }),
    );
    node.hidden = !isVisible(q, rowState);
    watchers.push({ node, question: q, state: rowState });
    return node;
  }

  function buildControl(q, rowState, fieldPath, id) {
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
        const select = el("select", {
          id,
          onchange: (e) => {
            if (e.target.value === "") delete rowState[q.id];
            else rowState[q.id] = e.target.value === "yes";
            refreshVisibility();
          },
        },
          el("option", { value: "" }, "— choose —"),
          el("option", { value: "yes" }, "Yes"),
          el("option", { value: "no" }, "No"));
        select.value = rowState[q.id] === true ? "yes" : rowState[q.id] === false ? "no" : "";
        return select;
      }
      case "choice": {
        const select = el("select", {
          id,
          onchange: (e) => {
            if (e.target.value === "") delete rowState[q.id];
            else rowState[q.id] = e.target.value;
            refreshVisibility();
          },
        },
          el("option", { value: "" }, "— choose —"),
          (q.options || []).map((o) => el("option", { value: o }, o)));
        select.value = rowState[q.id] ?? "";
        return select;
      }
      case "list":
        return buildList(q, rowState, fieldPath);
      default:
        return el("p", { class: "muted" }, `Unsupported question type: ${q.type}`);
    }
  }

  function buildList(q, rowState, fieldPath) {
    if (!Array.isArray(rowState[q.id]) || rowState[q.id].length === 0) rowState[q.id] = [{}];
    const rowName = q.row_label || "Item";
    const box = el("div", { class: "rows" });

    const draw = () => {
      box.replaceChildren(
        ...rowState[q.id].map((row, i) =>
          el("div", { class: "row-card" },
            el("div", { class: "row-head" },
              el("strong", {}, `${rowName} ${i + 1}`),
              el("button", {
                type: "button", class: "btn ghost small",
                onclick: () => { rowState[q.id].splice(i, 1); draw(); refreshVisibility(); },
              }, "Remove")),
            ...buildQuestions(q.item, row, `${fieldPath}[${i}].`))),
      );
    };
    draw();

    return el("div", {},
      box,
      el("button", {
        type: "button", class: "btn ghost small",
        onclick: () => { rowState[q.id].push({}); draw(); },
      }, `+ Add ${rowName.toLowerCase()}`));
  }

  // ---- form shell: summary, submit, error display ----
  const summary = el("div", { class: "banner error", role: "alert", hidden: true });
  const submitButton = el("button", { type: "submit", class: "btn" }, submitLabel);
  const form = el("form", { novalidate: true }, summary, ...buildQuestions(definition.questions, state, ""),
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

  return form;
}
