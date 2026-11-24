// Pure form logic (no DOM). The server repeats these checks and has the final word;
// doing them here only gives the user instant feedback.

export const isEmpty = (v) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

export function isVisible(question, answers) {
  const cond = question.show_if;
  if (!cond) return true;
  return answers[cond.question] === cond.equals;
}

// Options of a choice question: the answers typed in other lists when it has "options_from"
// (e.g. "servers.name" = every server name typed in "servers"; it may also be a list of such texts),
// then its fixed "options".
// owners: the rows the question sits in, by list id (e.g. { servers: <this server's row> }). A row never
// offers itself: a server's "Connected to" does not list that same server.
// Keep in step with choice_options() in backend/app/core/validation.py.
export function choiceOptions(question, root, owners = {}) {
  const options = [];
  const refs = !question.options_from ? [] : Array.isArray(question.options_from) ? question.options_from : [question.options_from];
  for (const ref of refs) {
    const [listId, field] = ref.split(".");
    const own = owners[listId];
    const rows = root && Array.isArray(root[listId]) ? root[listId] : [];
    for (const row of rows) {
      if (row === own) continue;
      const v = row && typeof row[field] === "string" ? row[field].trim() : "";
      if (v && !options.includes(v)) options.push(v);
    }
  }
  for (const o of question.options || []) if (!options.includes(o)) options.push(o);
  return options;
}

// Drop answers to hidden questions and blank rows, so only meaningful data is sent.
export function pruneHidden(questions, answers) {
  const out = {};
  for (const q of questions) {
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (isEmpty(value)) continue;
    if (q.type === "list") {
      const rows = value
        .map((row) => pruneHidden(q.item, row))
        .filter((row) => Object.keys(row).length > 0);
      if (rows.length) out[q.id] = rows;
    } else {
      out[q.id] = value;
    }
  }
  return out;
}

// Returns [{ path, message }]. Paths look like "servers[0].site".
// root: the top-level answers (used by "options_from"); defaults to answers.
// owners: the list rows these answers sit in, by list id (see choiceOptions).
export function validate(questions, answers, prefix = "", root = answers, owners = {}) {
  const errors = [];
  for (const q of questions) {
    const path = prefix + q.id;
    if (!isVisible(q, answers)) continue;
    const value = answers[q.id];
    if (isEmpty(value)) {
      if (q.required) errors.push({ path, message: "This answer is required" });
      continue;
    }
    switch (q.type) {
      case "text":
        if (typeof value !== "string") errors.push({ path, message: "Must be text" });
        break;
      case "number":
        if (!isNumber(value)) errors.push({ path, message: "Must be a number" });
        else if (q.min !== undefined && value < q.min) errors.push({ path, message: `Must be ${q.min} or more` });
        else if (q.max !== undefined && value > q.max) errors.push({ path, message: `Must be ${q.max} or less` });
        break;
      case "boolean":
        if (typeof value !== "boolean") errors.push({ path, message: "Choose yes or no" });
        break;
      case "choice":
        if (!choiceOptions(q, root, owners).includes(value)) errors.push({ path, message: "Choose one of the options" });
        break;
      case "list":
        if (!Array.isArray(value)) {
          errors.push({ path, message: "Must be a list" });
        } else {
          value.forEach((row, i) => errors.push(...validate(q.item, row, `${path}[${i}].`, root, { ...owners, [q.id]: row })));
        }
        break;
      default:
        errors.push({ path, message: `Unknown question type '${q.type}'` });
    }
  }
  return errors;
}

// Server errors arrive as "path: message" strings.
export function parseServerErrors(list) {
  return list.map((s) => {
    const i = s.indexOf(": ");
    return i === -1 ? { path: "", message: s } : { path: s.slice(0, i), message: s.slice(i + 2) };
  });
}
